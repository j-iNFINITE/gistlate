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
  translateCues: vi.fn(),
}))
vi.mock('../settings', () => ({
  loadSettings: vi.fn(() => ({
    tgt: 'zh-Hans',
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    github: { owner: 'owner', repo: 'pool', branch: 'main' },
    translation: { mode: 'sentence', batchSize: 8 },
  })),
  loadSecrets: vi.fn(() => ({ openaiKey: 'sk-test', githubPat: 'pat-test' })),
  normalizeTranslationSettings: vi.fn((value) => value ?? { mode: 'sentence', batchSize: 8 }),
}))
vi.mock('../usage/ledger', () => ({
  reconcileStaleUsageOperations: vi.fn().mockResolvedValue(0),
  beginUsageOperation: vi.fn().mockResolvedValue({ operationId: 'op-1' }),
  appendUsageResponse: vi.fn().mockResolvedValue(undefined),
  finalizeUsageOperation: vi.fn().mockResolvedValue(undefined),
}))

import { getL1, putL1 } from '../cache/l1'
import { readL2, writeL2 } from '../cache/l2github'
import { translateCues } from '../translate/pipeline'
import {
  appendUsageResponse,
  beginUsageOperation,
  finalizeUsageOperation,
} from '../usage/ledger'
import { resolveTranslation } from './resolve'

const mockGetL1 = vi.mocked(getL1)
const mockPutL1 = vi.mocked(putL1)
const mockReadL2 = vi.mocked(readL2)
const mockWriteL2 = vi.mocked(writeL2)
const mockTranslateCues = vi.mocked(translateCues)
const mockBeginUsageOperation = vi.mocked(beginUsageOperation)
const mockAppendUsageResponse = vi.mocked(appendUsageResponse)
const mockFinalizeUsageOperation = vi.mocked(finalizeUsageOperation)

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
  mockTranslateCues.mockResolvedValue({
    cues: TRANSLATED_CUES,
    diagnostics: {
      boundaryMethod: 'llm',
      boundaryRequestCount: 1,
      translationRequestCount: 1,
      alignmentRequestCount: 0,
      fallbackSentenceCount: 0,
    },
  })
})

describe('resolveTranslation', () => {
  it('returns an L1 hit without reading L2 or translating', async () => {
    mockGetL1.mockResolvedValue(cacheEntry())

    const result = await resolveTranslation('video', 'en', SOURCE_CUES)

    expect(result).toEqual({ cues: TRANSLATED_CUES, source: 'l1' })
    expect(mockReadL2).not.toHaveBeenCalled()
    expect(mockTranslateCues).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
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
    expect(mockTranslateCues).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
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
    expect(mockTranslateCues).toHaveBeenCalledWith(
      SOURCE_CUES,
      'zh-Hans',
      expect.objectContaining({ model: 'gpt-4o-mini' }),
      'sk-test',
      expect.objectContaining({
        signal: undefined,
        context,
        translation: { mode: 'sentence', batchSize: 8 },
      }),
    )
    expect(mockPutL1).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'video|en|zh-Hans',
        cues: TRANSLATED_CUES,
        generation: expect.objectContaining({
          strategy: expect.objectContaining({
            mode: 'sentence',
            effectiveRequestCount: 1,
            boundaryMethod: 'llm',
            boundaryRequestCount: 1,
            boundaryThinking: 'enabled',
          }),
        }),
      }),
    )
    expect(mockWriteL2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'pool' }),
      'pat-test',
      expect.objectContaining({ cues: TRANSLATED_CUES }),
      undefined,
      undefined,
    )
    expect(result).toEqual({ cues: TRANSLATED_CUES, source: 'fresh' })
    expect(mockFinalizeUsageOperation).toHaveBeenCalledWith('op-1', 'success')
  })

  it('does not write either cache when translation fails', async () => {
    mockTranslateCues.mockRejectedValue(new Error('model failed'))

    await expect(
      resolveTranslation('video', 'en', SOURCE_CUES, { force: true }),
    ).rejects.toThrow('model failed')

    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
    expect(mockFinalizeUsageOperation).toHaveBeenCalledWith('op-1', 'failed', 'Error')
  })

  it('passes an aborted signal through without writing', async () => {
    const controller = new AbortController()
    controller.abort()
    mockTranslateCues.mockRejectedValue(new Error('Translation pipeline aborted'))

    await expect(
      resolveTranslation('video', 'en', SOURCE_CUES, {
        force: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i)

    expect(mockTranslateCues).toHaveBeenCalledWith(
      SOURCE_CUES,
      'zh-Hans',
      expect.any(Object),
      'sk-test',
      expect.objectContaining({ signal: controller.signal, context: undefined }),
    )
    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
    expect(mockFinalizeUsageOperation).toHaveBeenCalledWith('op-1', 'aborted', 'Error')
  })

  it('does not write when navigation aborts just as translation completes', async () => {
    const controller = new AbortController()
    mockTranslateCues.mockImplementationOnce(async () => {
      controller.abort()
      return {
        cues: TRANSLATED_CUES,
        diagnostics: {
          boundaryMethod: 'llm',
          boundaryRequestCount: 1,
          translationRequestCount: 1,
          alignmentRequestCount: 0,
          fallbackSentenceCount: 0,
        },
      }
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

  it('records HTTP-success usage before building the successful artifact', async () => {
    mockTranslateCues.mockImplementationOnce(async (_cues, _target, _cfg, _key, options) => {
      await options.onUsage?.('translation', {
        promptTokens: 10,
        promptCacheHitTokens: 8,
        promptCacheMissTokens: 2,
        completionTokens: 4,
        totalTokens: 14,
      })
      return {
        cues: TRANSLATED_CUES,
        diagnostics: {
          boundaryMethod: 'llm',
          boundaryRequestCount: 1,
          translationRequestCount: 1,
          alignmentRequestCount: 0,
          fallbackSentenceCount: 0,
        },
      }
    })

    await resolveTranslation('video', 'en', SOURCE_CUES, { force: true })

    expect(mockAppendUsageResponse).toHaveBeenCalledWith(
      'op-1',
      'translation',
      expect.objectContaining({ promptCacheHitTokens: 8, completionTokens: 4 }),
    )
    expect(mockPutL1).toHaveBeenCalledWith(expect.objectContaining({
      generation: expect.objectContaining({
        usage: expect.objectContaining({
          requestCount: 1,
          tokens: expect.objectContaining({ completionTokens: 4 }),
        }),
      }),
    }))
  })

  it('records local timed boundaries without claiming boundary thinking was used', async () => {
    mockTranslateCues.mockResolvedValueOnce({
      cues: TRANSLATED_CUES,
      diagnostics: {
        boundaryMethod: 'timed-punctuation',
        boundaryRequestCount: 0,
        translationRequestCount: 1,
        alignmentRequestCount: 0,
        fallbackSentenceCount: 0,
      },
    })

    await resolveTranslation('video', 'en', SOURCE_CUES, { force: true })

    expect(mockPutL1).toHaveBeenCalledWith(expect.objectContaining({
      generation: expect.objectContaining({
        strategy: expect.objectContaining({
          boundaryMethod: 'timed-punctuation',
          boundaryRequestCount: 0,
          boundaryThinking: 'not-used',
        }),
      }),
    }))
  })
})
