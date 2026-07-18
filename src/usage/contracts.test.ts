import { describe, expect, it, vi } from 'vitest'
import {
  UsageCollector,
  addOperationUsageResponse,
  decodeRequestUsage,
  emptyOperationUsage,
} from './contracts'

describe('usage contracts', () => {
  it('decodes the full DeepSeek payload and keeps reasoning as a completion subset', () => {
    expect(decodeRequestUsage({
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
      completion_tokens: 40,
      total_tokens: 140,
      completion_tokens_details: { reasoning_tokens: 12 },
    })).toEqual({
      promptTokens: 100,
      promptCacheHitTokens: 80,
      promptCacheMissTokens: 20,
      completionTokens: 40,
      reasoningTokens: 12,
      totalTokens: 140,
    })
  })

  it('returns undefined for absent or wholly invalid usage', () => {
    expect(decodeRequestUsage(undefined)).toBeUndefined()
    expect(decodeRequestUsage({ prompt_tokens: -1, completion_tokens: 1.5 })).toBeUndefined()
  })

  it('tracks stage/request totals and marks fields omitted by a response incomplete', () => {
    const first = addOperationUsageResponse(emptyOperationUsage(), 'translation', {
      promptTokens: 10,
      completionTokens: 2,
    })
    const result = addOperationUsageResponse(first, 'alignment', undefined)
    expect(result.requestCount).toBe(2)
    expect(result.usageResponseCount).toBe(1)
    expect(result.tokens).toMatchObject({ promptTokens: 10, completionTokens: 2 })
    expect(result.stages.translation.requestCount).toBe(1)
    expect(result.stages.alignment.requestCount).toBe(1)
    expect(result.incompleteFields).toContain('promptTokens')
  })

  it('serializes concurrent durable-sink writes while aggregating immediately', async () => {
    const order: number[] = []
    const sink = vi.fn(async (_stage, usage) => {
      await Promise.resolve()
      order.push(usage?.completionTokens ?? -1)
    })
    const collector = new UsageCollector(sink)
    const a = collector.record('translation', { completionTokens: 1 })
    const b = collector.record('alignment', { completionTokens: 2 })
    expect(collector.snapshot().tokens.completionTokens).toBe(3)
    await Promise.all([a, b])
    expect(order).toEqual([1, 2])
  })
})
