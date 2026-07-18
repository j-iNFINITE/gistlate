import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({ unsafeWindow: {}, GM_xmlhttpRequest: vi.fn() }))
import type { PlayerCaptionData } from '../youtube'
import {
  buildTimedtextUrl,
  extractPotTokens,
  isTimedtextResponse,
} from './acquire'
import type { CaptionTrack } from './tracks'

const TRACK: CaptionTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=vid&lang=ja',
  languageCode: 'ja',
  kind: 'asr',
  vssId: 'a.ja',
}

function playerData(overrides: Partial<PlayerCaptionData> = {}): PlayerCaptionData {
  return {
    videoId: 'vid',
    captionTracks: [TRACK],
    audioCaptionTracks: [],
    playerState: 1,
    ...overrides,
  }
}

describe('active YouTube timedtext request', () => {
  it('adds JSON3/client/device/POT parameters without losing the selected base URL', () => {
    const url = new URL(buildTimedtextUrl(TRACK, playerData({
      device: 'cbrand=Google&cbr=Chrome&ignored=no',
      clientVersion: '2.20260718',
    }), { pot: 'token', potc: '7' }))

    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      v: 'vid',
      lang: 'ja',
      fmt: 'json3',
      c: 'WEB',
      cplayer: 'UNIPLAYER',
      cbrand: 'Google',
      cbr: 'Chrome',
      cver: '2.20260718',
      pot: 'token',
      potc: '7',
    })
    expect(url.searchParams.has('ignored')).toBe(false)
  })

  it('extracts POT from matching vssId before observed or unrelated audio tracks', () => {
    expect(extractPotTokens(TRACK, playerData({
      audioCaptionTracks: [
        {
          url: 'https://www.youtube.com/api/timedtext?lang=en&pot=wrong',
          vssId: '.en',
          languageCode: 'en',
          kind: 'manual',
        },
        {
          url: 'https://www.youtube.com/api/timedtext?lang=ja&pot=right&potc=2',
          vssId: 'a.ja',
          languageCode: 'ja',
          kind: 'asr',
        },
      ],
    }), 'https://www.youtube.com/api/timedtext?v=vid&pot=observed')).toEqual({
      pot: 'right',
      potc: '2',
    })
  })

  it('falls back to an observed same-video POT URL', () => {
    expect(extractPotTokens(
      TRACK,
      playerData(),
      'https://www.youtube.com/api/timedtext?v=vid&pot=observed',
    )).toEqual({ pot: 'observed', potc: undefined })
  })

  it('validates the minimum JSON3 event contract and rejects empty/malformed payloads', () => {
    expect(isTimedtextResponse({
      events: [{ tStartMs: 0, segs: [{ utf8: 'text', tOffsetMs: 0 }] }],
    })).toBe(true)
    expect(isTimedtextResponse({ events: [] })).toBe(false)
    expect(isTimedtextResponse({ events: [{ tStartMs: 0 }] })).toBe(false)
    expect(isTimedtextResponse({ events: [{ tStartMs: '0' }] })).toBe(false)
    expect(isTimedtextResponse({ events: [{ tStartMs: 0, segs: [{}] }] })).toBe(false)
  })
})
