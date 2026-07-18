import { describe, expect, it } from 'vitest'
import { calculateCostCny, resolvePricing } from './pricing'

describe('DeepSeek pricing', () => {
  it('recognizes only the official host and exact V4 model IDs', () => {
    expect(resolvePricing('https://api.deepseek.com', 'deepseek-v4-flash', 1)).toMatchObject({
      promptCacheHit: 0.02,
      promptCacheMiss: 1,
      completion: 2,
      capturedAt: 1,
    })
    expect(resolvePricing('https://proxy.example/deepseek', 'deepseek-v4-flash')).toBeUndefined()
    expect(resolvePricing('https://api.deepseek.com.evil.test', 'deepseek-v4-flash')).toBeUndefined()
    expect(resolvePricing('https://api.deepseek.com', 'deepseek-chat')).toBeUndefined()
  })

  it('uses hit/miss/output rates without double-charging reasoning tokens', () => {
    const pricing = resolvePricing('https://api.deepseek.com/anthropic', 'deepseek-v4-pro', 1)
    const cost = calculateCostCny({
      promptCacheHitTokens: 1_000_000,
      promptCacheMissTokens: 1_000_000,
      completionTokens: 1_000_000,
      reasoningTokens: 900_000,
    }, pricing)
    expect(cost).toBe(9.025)
  })

  it('does not fabricate cost when cache token breakdown is missing', () => {
    const pricing = resolvePricing('https://api.deepseek.com', 'deepseek-v4-flash')
    expect(calculateCostCny({ promptTokens: 10, completionTokens: 5 }, pricing)).toBeUndefined()
  })
})
