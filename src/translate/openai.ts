import { gmFetch } from '../net/gm'
import { fillPrompt, fillBoundaryPrompt, parseNumbered } from './prompt'
import type { OpenAIConfig } from '../settings'
import type { TranslationContext } from './context'
import { decodeRequestUsage, type RequestUsage } from '../usage/contracts'
import { isOfficialDeepSeek } from '../usage/pricing'

const NEW_MODELS = new Set([
  'gpt-5-nano', 'gpt-5', 'gpt-5-mini', 'o1', 'o3-mini', 'o4-mini', 'o3',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-pro',
])

export type CompletionRole = 'boundary' | 'translation' | 'alignment' | 'test'

export interface CompletionOptions {
  role: CompletionRole
  jsonOutput?: boolean
  onUsage?: (usage?: RequestUsage) => Promise<void> | void
}

/** A model response reduced to the fields callers may safely consume. */
export interface Completion {
  content: string
  /** 'length' when the output was truncated; null when unknown/complete. */
  finishReason: string | null
  usage?: RequestUsage
}

/** Thrown when the model cut its output off (finish_reason === 'length'). */
export class TruncationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TruncationError'
  }
}

/** Thrown when structured output never matched the requested IDs/count. */
export class CountMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CountMismatchError'
  }
}

export function isSplittable(err: unknown): boolean {
  return err instanceof TruncationError || err instanceof CountMismatchError
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/u, '')}/${path}`
}

function usesResponsesApi(cfg: OpenAIConfig): boolean {
  return cfg.baseUrl.includes('api.openai.com') && NEW_MODELS.has(cfg.model)
}

/**
 * Low-level completion owner shared by boundary, canonical translation and
 * alignment. Usage is delivered immediately after a successful HTTP response
 * is decoded and before any caller validates or parses the content.
 */
export async function completePrompt(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  options: CompletionOptions,
): Promise<Completion> {
  return usesResponsesApi(cfg)
    ? callResponsesAPI(system, user, cfg, apiKey, signal, options)
    : callChatAPI(system, user, cfg, apiKey, signal, options)
}

/** Compatibility helper used by connection tests and older focused callers. */
export async function translateBatch(
  texts: string[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
  retries = 3,
  context?: TranslationContext,
  onUsage?: (usage?: RequestUsage) => Promise<void> | void,
): Promise<string[]> {
  if (texts.length === 0) return []
  const { system, user } = fillPrompt(texts, targetLang, undefined, context)
  let lastError: Error | null = null

  for (let attempt = 0; attempt < retries; attempt++) {
    if (signal?.aborted) throw new Error('Translation aborted')
    try {
      const result = await completePrompt(system, user, cfg, apiKey, signal, {
        role: 'translation',
        onUsage,
      })
      if (result.finishReason === 'length') {
        throw new TruncationError(
          `OpenAI output truncated (finish_reason=length) for ${texts.length} lines`,
        )
      }
      try {
        return parseNumbered(result.content, texts.length)
      } catch (parseErr) {
        throw new CountMismatchError((parseErr as Error).message)
      }
    } catch (error) {
      if (error instanceof TruncationError) throw error
      lastError = error as Error
      if (signal?.aborted) throw lastError
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }
  throw lastError ?? new Error('Translation failed after retries')
}

export async function boundaryBatch(
  fragTexts: string[],
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
  onUsage?: (usage?: RequestUsage) => Promise<void> | void,
): Promise<Completion> {
  const { system, user } = fillBoundaryPrompt(fragTexts)
  return completePrompt(system, user, cfg, apiKey, signal, { role: 'boundary', onUsage })
}

function chatRequestBody(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  options: CompletionOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  if (options.role !== 'boundary') body.temperature = 0

  if (isOfficialDeepSeek(cfg.baseUrl, cfg.model)) {
    if (options.role === 'boundary') {
      body.thinking = { type: 'enabled' }
      body.reasoning_effort = 'high'
      delete body.temperature
    } else {
      body.thinking = { type: 'disabled' }
    }
    if (options.role === 'alignment' && options.jsonOutput) {
      body.response_format = { type: 'json_object' }
    }
  }
  return body
}

async function callChatAPI(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  options: CompletionOptions,
): Promise<Completion> {
  const r = await gmFetch({
    method: 'POST',
    url: endpoint(cfg.baseUrl, 'chat/completions'),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(chatRequestBody(system, user, cfg, options)),
    signal,
  })
  if (r.status !== 200) {
    throw new Error(`OpenAI API error ${r.status}: ${r.text.slice(0, 200)}`)
  }
  const data = JSON.parse(r.text) as Record<string, unknown>
  const usage = decodeRequestUsage(data.usage)
  await options.onUsage?.(usage)
  const choices = Array.isArray(data.choices) ? data.choices : []
  const choice = choices[0] as {
    message?: { content?: string }
    finish_reason?: string | null
  } | undefined
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    usage,
  }
}

async function callResponsesAPI(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  options: CompletionOptions,
): Promise<Completion> {
  const r = await gmFetch({
    method: 'POST',
    url: endpoint(cfg.baseUrl, 'responses'),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, instructions: system, input: user }),
    signal,
  })
  if (r.status !== 200) {
    throw new Error(`OpenAI Responses API error ${r.status}: ${r.text.slice(0, 200)}`)
  }
  const data = JSON.parse(r.text) as Record<string, unknown>
  const usage = decodeRequestUsage(data.usage)
  await options.onUsage?.(usage)
  const incompleteDetails = data.incomplete_details as { reason?: string } | undefined
  const truncated = data.status === 'incomplete' && incompleteDetails?.reason === 'max_output_tokens'
  const output = Array.isArray(data.output) ? data.output : []
  const first = output[0] as { content?: Array<{ text?: string }> } | undefined
  return {
    content: first?.content?.[0]?.text ?? '',
    finishReason: truncated ? 'length' : null,
    usage,
  }
}

export async function testOpenAI(
  cfg: OpenAIConfig,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await translateBatch(['hello'], 'zh-Hans', cfg, apiKey, undefined, 1)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
