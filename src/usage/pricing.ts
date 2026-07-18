import type { RequestUsage } from './contracts'

export interface PricingSnapshot {
  provider: 'deepseek'
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  currency: 'CNY'
  unit: 'million_tokens'
  promptCacheHit: number
  promptCacheMiss: number
  completion: number
  capturedAt: number
}

const RATES = {
  'deepseek-v4-flash': { promptCacheHit: 0.02, promptCacheMiss: 1, completion: 2 },
  'deepseek-v4-pro': { promptCacheHit: 0.025, promptCacheMiss: 3, completion: 6 },
} as const

export function isOfficialDeepSeek(baseUrl: string, model?: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'https:' && url.hostname === 'api.deepseek.com' &&
      (!model || model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro')
  } catch {
    return false
  }
}

export function resolvePricing(
  baseUrl: string,
  model: string,
  capturedAt = Date.now(),
): PricingSnapshot | undefined {
  if (!isOfficialDeepSeek(baseUrl, model)) return undefined
  if (model !== 'deepseek-v4-flash' && model !== 'deepseek-v4-pro') return undefined
  return {
    provider: 'deepseek',
    model,
    currency: 'CNY',
    unit: 'million_tokens',
    ...RATES[model],
    capturedAt,
  }
}

/** Reasoning tokens are already included in completionTokens and are never added again. */
export function calculateCostCny(
  usage: RequestUsage,
  pricing?: PricingSnapshot,
): number | undefined {
  if (!pricing || usage.promptCacheHitTokens === undefined ||
      usage.promptCacheMissTokens === undefined || usage.completionTokens === undefined) {
    return undefined
  }
  return (
    usage.promptCacheHitTokens * pricing.promptCacheHit +
    usage.promptCacheMissTokens * pricing.promptCacheMiss +
    usage.completionTokens * pricing.completion
  ) / 1_000_000
}
