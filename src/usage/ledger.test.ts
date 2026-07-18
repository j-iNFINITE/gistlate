import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendUsageResponse,
  beginUsageOperation,
  clearUsageHistory,
  finalizeUsageOperation,
  getVideoUsage,
  reconcileStaleUsageOperations,
  selectRetainedOperationIds,
  type UsageOperation,
} from './ledger'
import { emptyOperationUsage } from './contracts'
import { resolvePricing } from './pricing'
import { clearL1 } from '../cache/l1'

function operation(videoId: string, index: number): UsageOperation {
  return {
    operationId: `${videoId}-${index}`,
    videoId,
    src: 'ja',
    tgt: 'zh-Hans',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    force: false,
    strategy: { mode: 'sentence', configuredBatchSize: 8 },
    status: 'success',
    startedAt: index,
    endedAt: index,
    usage: emptyOperationUsage(),
  }
}

describe('usage detail retention', () => {
  it('keeps the newest 20 operation details per video', () => {
    const operations = Array.from({ length: 25 }, (_, index) => operation('video', index))
    const retained = selectRetainedOperationIds(operations)
    expect(retained.size).toBe(20)
    expect(retained.has('video-24')).toBe(true)
    expect(retained.has('video-4')).toBe(false)
  })

  it('caps retained details globally at 2,000', () => {
    const operations = Array.from({ length: 101 }, (_, video) =>
      Array.from({ length: 20 }, (_, index) => operation(`v${video}`, video * 100 + index)),
    ).flat()
    expect(selectRetainedOperationIds(operations).size).toBe(2000)
  })
})

describe('persistent usage ledger', () => {
  beforeEach(async () => {
    await clearUsageHistory()
  })

  async function begin(videoId = 'video') {
    return beginUsageOperation({
      videoId,
      src: 'ja',
      tgt: 'zh-Hans',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      force: false,
      strategy: { mode: 'sentence', configuredBatchSize: 8 },
      pricing: resolvePricing('https://api.deepseek.com', 'deepseek-v4-flash', 1),
    })
  }

  it('persists running usage, final status, lifetime totals and calculated cost', async () => {
    const current = await begin()
    await appendUsageResponse(current.operationId, 'boundary', {
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 100,
      completionTokens: 20,
    })
    await appendUsageResponse(current.operationId, 'translation', {
      promptCacheHitTokens: 80,
      promptCacheMissTokens: 20,
      completionTokens: 10,
    })
    const finished = await finalizeUsageOperation(current.operationId, 'success')
    const stored = await getVideoUsage('video')

    expect(finished).toMatchObject({ status: 'success', costCny: 0.0001816 })
    expect(stored.total).toMatchObject({
      startedOperations: 1,
      successOperations: 1,
      failedOperations: 0,
      abortedOperations: 0,
      costCny: 0.0001816,
    })
    expect(stored.total?.usage).toMatchObject({
      requestCount: 2,
      usageResponseCount: 2,
      tokens: {
        promptCacheHitTokens: 80,
        promptCacheMissTokens: 120,
        completionTokens: 30,
      },
    })
    expect(stored.operations).toHaveLength(1)
  })

  it('reconciles stale running operations as aborted without adding usage', async () => {
    const current = await begin('stale')
    await appendUsageResponse(current.operationId, 'translation', { completionTokens: 4 })
    expect(await reconcileStaleUsageOperations()).toBe(1)
    const stored = await getVideoUsage('stale')
    expect(stored.operations[0].status).toBe('aborted')
    expect(stored.operations[0].usage.requestCount).toBe(1)
    expect(stored.total?.abortedOperations).toBe(1)
  })

  it('keeps usage history when the independent subtitle L1 cache is cleared', async () => {
    const current = await begin('independent')
    await finalizeUsageOperation(current.operationId, 'failed')
    await clearL1()
    const stored = await getVideoUsage('independent')
    expect(stored.total?.failedOperations).toBe(1)
    expect(stored.operations).toHaveLength(1)
  })
})
