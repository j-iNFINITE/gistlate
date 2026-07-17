import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '../subtitles/timedtext'

vi.mock('../cache/l1', () => ({
  getL1: vi.fn(),
  putL1: vi.fn(),
}))
vi.mock('../cache/l2github', () => ({
  readL2: vi.fn(),
  writeL2: vi.fn(),
}))
vi.mock('../translate/pipeline', () => ({
  translateAllCues: vi.fn(),
}))
vi.mock('../settings', () => ({
  loadSettings: vi.fn(() => ({
    tgt: 'zh-Hans',
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    github: { owner: 'owner', repo: 'pool', branch: 'main' },
  })),
  loadSecrets: vi.fn(() => ({ openaiKey: 'sk-test', githubPat: 'pat-test' })),
}))

import { getL1, putL1 } from '../cache/l1'
import { readL2, writeL2 } from '../cache/l2github'
import { translateAllCues } from '../translate/pipeline'
import { resolveTranslation } from './resolve'

const mockGetL1 = vi.mocked(getL1)
const mockPutL1 = vi.mocked(putL1)
const mockReadL2 = vi.mocked(readL2)
const mockWriteL2 = vi.mocked(writeL2)
const mockTranslateAllCues = vi.mocked(translateAllCues)

const SOURCE_CUES: Cue[] = [{ s: 0, d: 1000, o: 'hello' }]
const TRANSLATED_CUES: Cue[] = [{ s: 0, d: 1000, o: 'hello', t: '你好' }]

function cacheEntry(cues = TRANSLATED_CUES) {
  return {
    key: 'video|en|zh-Hans',
    videoId: 'video',
    src: 'en',
    tgt: 'zh-Hans',
    model: 'gpt-4o-mini',
    cues,
    createdAt: 1,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetL1.mockResolvedValue(undefined)
  mockReadL2.mockResolvedValue(undefined)
  mockPutL1.mockResolvedValue(undefined)
  mockWriteL2.mockResolvedValue(undefined)
  mockTranslateAllCues.mockResolvedValue(TRANSLATED_CUES)
})

describe('resolveTranslation', () => {
  it('returns an L1 hit without reading L2 or translating', async () => {
    mockGetL1.mockResolvedValue(cacheEntry())

    const result = await resolveTranslation('video', 'en', SOURCE_CUES)

    expect(result).toEqual({ cues: TRANSLATED_CUES, source: 'l1' })
    expect(mockReadL2).not.toHaveBeenCalled()
    expect(mockTranslateAllCues).not.toHaveBeenCalled()
  })

  it('returns an L2 hit, backfills L1, and skips translation', async () => {
    const entry = cacheEntry()
    mockReadL2.mockResolvedValue(entry)

    const result = await resolveTranslation('video', 'en', SOURCE_CUES)

    expect(mockGetL1).toHaveBeenCalledWith('video|en|zh-Hans')
    expect(mockReadL2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'pool' }),
      { videoId: 'video', src: 'en', tgt: 'zh-Hans' },
    )
    expect(mockPutL1).toHaveBeenCalledWith(entry)
    expect(mockTranslateAllCues).not.toHaveBeenCalled()
    expect(result).toEqual({ cues: TRANSLATED_CUES, source: 'l2' })
  })

  it('force mode skips both reads and replaces caches only after translation succeeds', async () => {
    const onTranslating = vi.fn()
    const context = { title: 'Video title', description: 'Video description' }
    mockGetL1.mockResolvedValue(cacheEntry())
    mockReadL2.mockResolvedValue(cacheEntry())

    const result = await resolveTranslation('video', 'en', SOURCE_CUES, {
      force: true,
      context,
      onTranslating,
    })

    expect(mockGetL1).not.toHaveBeenCalled()
    expect(mockReadL2).not.toHaveBeenCalled()
    expect(onTranslating).toHaveBeenCalledOnce()
    expect(mockTranslateAllCues).toHaveBeenCalledWith(
      SOURCE_CUES,
      'zh-Hans',
      expect.objectContaining({ model: 'gpt-4o-mini' }),
      'sk-test',
      undefined,
      context,
    )
    expect(mockPutL1).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'video|en|zh-Hans',
        cues: TRANSLATED_CUES,
      }),
    )
    expect(mockWriteL2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'pool' }),
      'pat-test',
      expect.objectContaining({ cues: TRANSLATED_CUES }),
    )
    expect(result).toEqual({ cues: TRANSLATED_CUES, source: 'fresh' })
  })

  it('does not write either cache when translation fails', async () => {
    mockTranslateAllCues.mockRejectedValue(new Error('model failed'))

    await expect(
      resolveTranslation('video', 'en', SOURCE_CUES, { force: true }),
    ).rejects.toThrow('model failed')

    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
  })

  it('passes an aborted signal through without writing', async () => {
    const controller = new AbortController()
    controller.abort()
    mockTranslateAllCues.mockRejectedValue(new Error('Translation pipeline aborted'))

    await expect(
      resolveTranslation('video', 'en', SOURCE_CUES, {
        force: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i)

    expect(mockTranslateAllCues).toHaveBeenCalledWith(
      SOURCE_CUES,
      'zh-Hans',
      expect.any(Object),
      'sk-test',
      controller.signal,
      undefined,
    )
    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
  })

  it('does not write when navigation aborts just as translation completes', async () => {
    const controller = new AbortController()
    mockTranslateAllCues.mockImplementationOnce(async () => {
      controller.abort()
      return TRANSLATED_CUES
    })

    await expect(
      resolveTranslation('video', 'en', SOURCE_CUES, {
        force: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i)

    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
  })
})
