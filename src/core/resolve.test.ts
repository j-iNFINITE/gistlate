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
import { loadSecrets } from '../settings'
import { resolveTranslation } from './resolve'

const mockGetL1 = vi.mocked(getL1)
const mockPutL1 = vi.mocked(putL1)
const mockReadL2 = vi.mocked(readL2)
const mockWriteL2 = vi.mocked(writeL2)
const mockTranslateCues = vi.mocked(translateCues)
const mockBeginUsageOperation = vi.mocked(beginUsageOperation)
const mockAppendUsageResponse = vi.mocked(appendUsageResponse)
const mockFinalizeUsageOperation = vi.mocked(finalizeUsageOperation)
const mockLoadSecrets = vi.mocked(loadSecrets)

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

    const beforeFreshTranslation = vi.fn()
    const result = await resolveTranslation('video', 'en', SOURCE_CUES, {
      beforeFreshTranslation,
    })

    expect(result).toEqual({
      status: 'ready',
      cues: TRANSLATED_CUES,
      source: 'l1',
      artifact: cacheEntry(),
    })
    expect(mockReadL2).not.toHaveBeenCalled()
    expect(beforeFreshTranslation).not.toHaveBeenCalled()
    expect(mockTranslateCues).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
  })

  it('returns an L2 hit, backfills L1, and skips translation', async () => {
    const entry = cacheEntry()
    mockReadL2.mockResolvedValue(entry)

    const beforeFreshTranslation = vi.fn()
    const result = await resolveTranslation('video', 'en', SOURCE_CUES, {
      beforeFreshTranslation,
    })

    expect(mockGetL1).toHaveBeenCalledWith('video|en|zh-Hans')
    expect(mockReadL2).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'pool' }),
      { videoId: 'video', src: 'en', tgt: 'zh-Hans' },
    )
    expect(mockPutL1).toHaveBeenCalledWith(entry)
    expect(mockTranslateCues).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
    expect(beforeFreshTranslation).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'ready',
      cues: TRANSLATED_CUES,
      source: 'l2',
      artifact: entry,
    })
  })

  it('treats same-key L1/L2 entries from a different source track as misses', async () => {
    const stale = cacheEntry([{ s: 0, d: 1000, o: 'wrong ASR text', t: '错误' }])
    mockGetL1.mockResolvedValue(stale)
    mockReadL2.mockResolvedValue(stale)

    const result = await resolveTranslation('video', 'en', SOURCE_CUES)

    expect(mockTranslateCues).toHaveBeenCalledOnce()
    expect(mockPutL1).toHaveBeenCalledWith(expect.objectContaining({ cues: TRANSLATED_CUES }))
    expect(result).toMatchObject({ status: 'ready', source: 'fresh' })
  })

  it('passes manual track kind to the pipeline and records optional source metadata', async () => {
    await resolveTranslation('video', 'en', SOURCE_CUES, {
      force: true,
      track: { languageCode: 'en', kind: 'manual', vssId: '.en' },
    })

    expect(mockTranslateCues).toHaveBeenCalledWith(
      SOURCE_CUES,
      'zh-Hans',
      expect.anything(),
      'sk-test',
      expect.objectContaining({ sourceKind: 'manual' }),
    )
    expect(mockPutL1).toHaveBeenCalledWith(expect.objectContaining({
      track: expect.objectContaining({
        languageCode: 'en',
        kind: 'manual',
        vssId: '.en',
        sourceFingerprint: expect.stringMatching(/^sha256-v1:/),
      }),
    }))
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
    expect(result).toMatchObject({
      status: 'ready',
      cues: TRANSLATED_CUES,
      source: 'fresh',
      artifact: { key: 'video|en|zh-Hans', cues: TRANSLATED_CUES },
    })
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

  it('rejects an already aborted signal before secrets, usage or translation', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      resolveTranslation('video', 'en', SOURCE_CUES, {
        force: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/abort/i)

    expect(mockLoadSecrets).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
    expect(mockTranslateCues).not.toHaveBeenCalled()
    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
    expect(mockFinalizeUsageOperation).not.toHaveBeenCalled()
  })

  it.each([
    'long-video',
    'current-live',
    'user-declined',
    'settings-opened',
  ] as const)('returns a typed %s skip with zero billable side effects', async (reason) => {
    const onTranslating = vi.fn()
    const beforeFreshTranslation = vi.fn().mockResolvedValue({ action: 'skip', reason })

    const result = await resolveTranslation('video', 'en', SOURCE_CUES, {
      onTranslating,
      beforeFreshTranslation,
    })

    expect(result).toEqual({ status: 'skipped', reason })
    expect(beforeFreshTranslation).toHaveBeenCalledOnce()
    expect(onTranslating).not.toHaveBeenCalled()
    expect(mockLoadSecrets).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
    expect(mockTranslateCues).not.toHaveBeenCalled()
    expect(mockPutL1).not.toHaveBeenCalled()
    expect(mockWriteL2).not.toHaveBeenCalled()
    expect(mockFinalizeUsageOperation).not.toHaveBeenCalled()
  })

  it('runs the preflight in force mode after skipping cache reads', async () => {
    const beforeFreshTranslation = vi.fn().mockResolvedValue({
      action: 'skip',
      reason: 'long-video',
    })

    const result = await resolveTranslation('video', 'en', SOURCE_CUES, {
      force: true,
      beforeFreshTranslation,
    })

    expect(result).toEqual({ status: 'skipped', reason: 'long-video' })
    expect(mockGetL1).not.toHaveBeenCalled()
    expect(mockReadL2).not.toHaveBeenCalled()
    expect(beforeFreshTranslation).toHaveBeenCalledOnce()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
    expect(mockTranslateCues).not.toHaveBeenCalled()
  })

  it('rechecks abort after an awaited preflight and before billable work', async () => {
    const controller = new AbortController()
    const beforeFreshTranslation = vi.fn().mockImplementation(async () => {
      controller.abort()
      return { action: 'continue' as const }
    })

    await expect(resolveTranslation('video', 'en', SOURCE_CUES, {
      signal: controller.signal,
      beforeFreshTranslation,
    })).rejects.toThrow(/abort/i)

    expect(mockLoadSecrets).not.toHaveBeenCalled()
    expect(mockBeginUsageOperation).not.toHaveBeenCalled()
    expect(mockTranslateCues).not.toHaveBeenCalled()
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

  it('rechecks navigation abort after pending usage writes and before L1 persistence', async () => {
    const controller = new AbortController()
    let releaseUsageWrite: (() => void) | undefined
    mockAppendUsageResponse.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseUsageWrite = () => {
        controller.abort()
        resolve()
      }
    }))
    mockTranslateCues.mockImplementationOnce(async (_cues, _target, _cfg, _key, options) => {
      void options.onUsage?.('translation', { promptTokens: 1 })
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

    const resolving = resolveTranslation('video', 'en', SOURCE_CUES, {
      force: true,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(releaseUsageWrite).toBeTypeOf('function'))
    releaseUsageWrite?.()

    await expect(resolving).rejects.toThrow(/abort/i)
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
