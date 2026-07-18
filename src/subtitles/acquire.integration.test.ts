import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPlayerCaptionData: vi.fn(),
  ensureCaptions: vi.fn(),
  gmFetch: vi.fn(),
  getObservedPotUrl: vi.fn(),
  getObservedTimedtext: vi.fn(),
  getObservedTimedtextCandidates: vi.fn(() => []),
  waitForObservedTimedtext: vi.fn(),
}))

vi.mock('../youtube', () => ({
  getPlayerCaptionData: mocks.getPlayerCaptionData,
  ensureCaptions: mocks.ensureCaptions,
}))
vi.mock('../net/gm', () => ({ gmFetch: mocks.gmFetch }))
vi.mock('../intercept/netHook', () => ({
  getObservedPotUrl: mocks.getObservedPotUrl,
  getObservedTimedtext: mocks.getObservedTimedtext,
  getObservedTimedtextCandidates: mocks.getObservedTimedtextCandidates,
  waitForObservedTimedtext: mocks.waitForObservedTimedtext,
}))

import { acquireCurrentSubtitles } from './acquire'
import type { CaptionTrack } from './tracks'

const MANUAL_ZH: CaptionTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=vid&lang=zh-CN&vssId=.zh-CN',
  languageCode: 'zh-CN',
  kind: 'manual',
  vssId: '.zh-CN',
}

const ASR_JA: CaptionTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=vid&lang=ja&kind=asr&vssId=a.ja',
  languageCode: 'ja',
  kind: 'asr',
  vssId: 'a.ja',
  audioLanguageMatch: true,
}

const JSON3 = { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '字幕' }] }] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getObservedTimedtext.mockReturnValue(undefined)
  mocks.getObservedPotUrl.mockReturnValue(undefined)
  mocks.waitForObservedTimedtext.mockResolvedValue(undefined)
  mocks.getObservedTimedtextCandidates.mockReturnValue([])
})

describe('canonical acquisition orchestration', () => {
  it('actively fetches the selected target-language manual track', async () => {
    mocks.getPlayerCaptionData.mockReturnValue({
      videoId: 'vid',
      captionTracks: [ASR_JA, MANUAL_ZH],
      audioCaptionTracks: [],
      audioLanguage: 'ja',
      playerState: 1,
    })
    mocks.gmFetch.mockResolvedValue({ status: 200, text: JSON.stringify(JSON3) })

    const result = await acquireCurrentSubtitles('vid', 'zh-Hans')

    expect(result).toMatchObject({
      source: 'direct',
      selected: { purpose: 'direct-target', track: { vssId: '.zh-CN' } },
      json: JSON3,
    })
    expect(mocks.gmFetch).toHaveBeenCalledOnce()
  })

  it('retries the canonical ASR track with matching audio POT after a fast 403', async () => {
    mocks.getPlayerCaptionData.mockReturnValue({
      videoId: 'vid',
      captionTracks: [ASR_JA],
      audioCaptionTracks: [{
        url: 'https://www.youtube.com/api/timedtext?v=vid&lang=ja&kind=asr&vssId=a.ja&pot=token',
        languageCode: 'ja',
        kind: 'asr',
        vssId: 'a.ja',
      }],
      audioLanguage: 'ja',
      playerState: 1,
    })
    mocks.gmFetch
      .mockResolvedValueOnce({ status: 403, text: '' })
      .mockResolvedValueOnce({ status: 200, text: JSON.stringify(JSON3) })

    const result = await acquireCurrentSubtitles('vid', 'zh-Hans')

    expect(result.selected.purpose).toBe('translate-asr')
    expect(mocks.gmFetch).toHaveBeenCalledTimes(2)
    expect(new URL(mocks.gmFetch.mock.calls[1][0].url).searchParams.get('pot')).toBe('token')
    expect(mocks.ensureCaptions).not.toHaveBeenCalled()
  })

  it('uses an already intercepted canonical payload without another request', async () => {
    mocks.getPlayerCaptionData.mockReturnValue({
      videoId: 'vid',
      captionTracks: [ASR_JA],
      audioCaptionTracks: [],
      audioLanguage: 'ja',
      playerState: 1,
    })
    mocks.getObservedTimedtext.mockReturnValue({
      videoId: 'vid',
      url: ASR_JA.baseUrl,
      params: new URL(ASR_JA.baseUrl).searchParams,
      track: ASR_JA,
      json: JSON3,
    })

    const result = await acquireCurrentSubtitles('vid', 'zh-Hans')

    expect(result.source).toBe('intercept')
    expect(mocks.gmFetch).not.toHaveBeenCalled()
  })

  it('accepts an intercepted canonical response that wins the active-fetch race', async () => {
    mocks.getPlayerCaptionData.mockReturnValue({
      videoId: 'vid',
      captionTracks: [ASR_JA],
      audioCaptionTracks: [],
      audioLanguage: 'ja',
      playerState: 1,
    })
    mocks.gmFetch.mockReturnValue(new Promise(() => {}))
    mocks.waitForObservedTimedtext.mockResolvedValue({
      videoId: 'vid',
      url: ASR_JA.baseUrl,
      params: new URL(ASR_JA.baseUrl).searchParams,
      track: ASR_JA,
      json: JSON3,
    })

    const result = await acquireCurrentSubtitles('vid', 'zh-Hans')

    expect(result.source).toBe('intercept')
    expect(mocks.gmFetch).toHaveBeenCalledOnce()
    expect(mocks.waitForObservedTimedtext).toHaveBeenCalledWith(
      'vid',
      ASR_JA,
      6500,
      undefined,
      true,
    )
  })

  it('treats 404 as terminal without entering the POT fallback', async () => {
    mocks.getPlayerCaptionData.mockReturnValue({
      videoId: 'vid',
      captionTracks: [ASR_JA],
      audioCaptionTracks: [],
      audioLanguage: 'ja',
      playerState: 1,
    })
    mocks.gmFetch.mockResolvedValue({ status: 404, text: '' })

    await expect(acquireCurrentSubtitles('vid', 'zh-Hans')).rejects.toMatchObject({
      code: 'HTTP',
    })
    expect(mocks.gmFetch).toHaveBeenCalledOnce()
    expect(mocks.ensureCaptions).not.toHaveBeenCalled()
  })

  it('aborts before player polling or network acquisition begins', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(acquireCurrentSubtitles('vid', 'zh-Hans', {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.getPlayerCaptionData).not.toHaveBeenCalled()
    expect(mocks.gmFetch).not.toHaveBeenCalled()
  })
})
