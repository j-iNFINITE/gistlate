export type UsageStage = 'boundary' | 'translation' | 'alignment'

export interface RequestUsage {
  promptTokens?: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

export const TOKEN_FIELDS = [
  'promptTokens',
  'promptCacheHitTokens',
  'promptCacheMissTokens',
  'completionTokens',
  'reasoningTokens',
  'totalTokens',
] as const

export type TokenField = (typeof TOKEN_FIELDS)[number]

export interface UsageAggregate {
  requestCount: number
  usageResponseCount: number
  tokens: RequestUsage
  /** Fields omitted by at least one counted usage payload. */
  incompleteFields: TokenField[]
}

export interface TranslationOperationUsage extends UsageAggregate {
  stages: Record<UsageStage, UsageAggregate>
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
    ? value
    : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined
}

/** Decode an untrusted OpenAI/DeepSeek usage object without fabricating zeros. */
export function decodeRequestUsage(value: unknown): RequestUsage | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const details = record(usage.completion_tokens_details) ?? record(usage.output_tokens_details)
  const decoded: RequestUsage = {
    promptTokens: nonNegativeInteger(usage.prompt_tokens ?? usage.input_tokens),
    promptCacheHitTokens: nonNegativeInteger(usage.prompt_cache_hit_tokens),
    promptCacheMissTokens: nonNegativeInteger(usage.prompt_cache_miss_tokens),
    completionTokens: nonNegativeInteger(usage.completion_tokens ?? usage.output_tokens),
    reasoningTokens: nonNegativeInteger(details?.reasoning_tokens),
    totalTokens: nonNegativeInteger(usage.total_tokens),
  }
  if (TOKEN_FIELDS.every((field) => decoded[field] === undefined)) return undefined
  return decoded
}

export function emptyUsageAggregate(): UsageAggregate {
  return { requestCount: 0, usageResponseCount: 0, tokens: {}, incompleteFields: [] }
}

export function emptyOperationUsage(): TranslationOperationUsage {
  return {
    ...emptyUsageAggregate(),
    stages: {
      boundary: emptyUsageAggregate(),
      translation: emptyUsageAggregate(),
      alignment: emptyUsageAggregate(),
    },
  }
}

/** Add one HTTP-success completion response. Missing usage still counts as a request. */
export function addUsageResponse(
  aggregate: UsageAggregate,
  usage?: RequestUsage,
): UsageAggregate {
  const incomplete = new Set(aggregate.incompleteFields)
  const tokens: RequestUsage = { ...aggregate.tokens }

  for (const field of TOKEN_FIELDS) {
    const value = usage?.[field]
    if (value === undefined) {
      incomplete.add(field)
    } else {
      tokens[field] = (tokens[field] ?? 0) + value
    }
  }

  return {
    requestCount: aggregate.requestCount + 1,
    usageResponseCount: aggregate.usageResponseCount + (usage ? 1 : 0),
    tokens,
    incompleteFields: TOKEN_FIELDS.filter((field) => incomplete.has(field)),
  }
}

export function addOperationUsageResponse(
  operation: TranslationOperationUsage,
  stage: UsageStage,
  usage?: RequestUsage,
): TranslationOperationUsage {
  const total = addUsageResponse(operation, usage)
  return {
    ...total,
    stages: {
      ...operation.stages,
      [stage]: addUsageResponse(operation.stages[stage], usage),
    },
  }
}

export class UsageCollector {
  private usage = emptyOperationUsage()
  private sinkChain = Promise.resolve()

  constructor(
    private readonly sink?: (stage: UsageStage, usage?: RequestUsage) => Promise<void> | void,
  ) {}

  /** Memory aggregation is synchronous; the optional durable sink is serialized. */
  record(stage: UsageStage, usage?: RequestUsage): Promise<void> {
    this.usage = addOperationUsageResponse(this.usage, stage, usage)
    this.sinkChain = this.sinkChain.then(() => this.sink?.(stage, usage)).then(() => undefined)
    return this.sinkChain
  }

  snapshot(): TranslationOperationUsage {
    return structuredClone(this.usage)
  }

  flush(): Promise<void> {
    return this.sinkChain
  }
}
