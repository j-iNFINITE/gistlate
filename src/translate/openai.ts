import { gmFetch } from '../net/gm'
import { fillPrompt, fillBoundaryPrompt, parseNumbered } from './prompt'
import type { OpenAIConfig } from '../settings'
import type { TranslationContext } from './context'

const NEW_MODELS = new Set([
  'gpt-5-nano', 'gpt-5', 'gpt-5-mini', 'o1', 'o3-mini', 'o4-mini', 'o3',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-pro',
])

/** Thrown when the model cut its output off (finish_reason === 'length'). */
export class TruncationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TruncationError'
  }
}

/** Thrown when numbered output never matched the requested line count after retries. */
export class CountMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CountMismatchError'
  }
}

/**
 * True when an error signals an output-size problem (truncation or line-count
 * mismatch) that translating a smaller range might fix. Network/API errors are
 * NOT splittable and must propagate as-is.
 */
export function isSplittable(err: unknown): boolean {
  return err instanceof TruncationError || err instanceof CountMismatchError
}

/** A model response reduced to the fields we need. */
interface Completion {
  content: string
  /** 'length' when the output was truncated; null when unknown/complete. */
  finishReason: string | null
}

/**
 * Translate a batch of text lines via an OpenAI-compatible API.
 * Returns translated lines in the same order.
 */
export async function translateBatch(
  texts: string[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
  retries = 3,
  context?: TranslationContext,
): Promise<string[]> {
  if (texts.length === 0) return []

  const { system, user } = fillPrompt(texts, targetLang, undefined, context)

  let lastError: Error | null = null

  for (let attempt = 0; attempt < retries; attempt++) {
    if (signal?.aborted) throw new Error('Translation aborted')

    try {
      const useResponsesAPI =
        cfg.baseUrl.includes('api.openai.com') &&
        NEW_MODELS.has(cfg.model)

      const result = useResponsesAPI
        ? await callResponsesAPI(system, user, cfg, apiKey, signal)
        : await callChatAPI(system, user, cfg, apiKey, signal)

      // Truncated output is deterministic for the same input — don't burn retries;
      // fail fast so the pipeline can split the range and try smaller pieces.
      if (result.finishReason === 'length') {
        throw new TruncationError(
          `OpenAI output truncated (finish_reason=length) for ${texts.length} lines`,
        )
      }

      // parseNumbered throws on any count/format mismatch; surface it as a typed,
      // splittable error so the caller can decide whether to split or fail.
      try {
        return parseNumbered(result.content, texts.length)
      } catch (parseErr) {
        throw new CountMismatchError((parseErr as Error).message)
      }
    } catch (e) {
      // Truncation won't improve on retry — propagate immediately.
      if (e instanceof TruncationError) throw e

      lastError = e as Error
      if (signal?.aborted) throw lastError
      // Backoff: 1s, 2s (skip the wait after the final attempt).
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
  }

  throw lastError ?? new Error('Translation failed after retries')
}

/**
 * Pass 1 — boundary detection. Asks the model, for each fragment, whether it
 * ends a sentence (`E`) or continues (`C`). Returns the raw model content plus
 * its finish reason; parsing/validation and the retry/fallback policy live in
 * the pipeline. Uses the same transport as `translateBatch`. No target language:
 * the boundary decision is source-side only.
 */
export async function boundaryBatch(
  fragTexts: string[],
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ content: string; finishReason: string | null }> {
  const { system, user } = fillBoundaryPrompt(fragTexts)

  const useResponsesAPI =
    cfg.baseUrl.includes('api.openai.com') && NEW_MODELS.has(cfg.model)

  const result = useResponsesAPI
    ? await callResponsesAPI(system, user, cfg, apiKey, signal)
    : await callChatAPI(system, user, cfg, apiKey, signal)

  return { content: result.content, finishReason: result.finishReason }
}

async function callChatAPI(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Completion> {
  const r = await gmFetch({
    method: 'POST',
    url: `${cfg.baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal,
  })
  if (r.status !== 200) {
    throw new Error(`OpenAI API error ${r.status}: ${r.text.slice(0, 200)}`)
  }
  const data = JSON.parse(r.text)
  const choice = data.choices?.[0]
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
  }
}

async function callResponsesAPI(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Completion> {
  const r = await gmFetch({
    method: 'POST',
    url: `${cfg.baseUrl}/responses`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      instructions: system,
      input: user,
    }),
    signal,
  })
  if (r.status !== 200) {
    throw new Error(`OpenAI Responses API error ${r.status}: ${r.text.slice(0, 200)}`)
  }
  const data = JSON.parse(r.text)
  // The Responses API has no `finish_reason`; truncation surfaces as
  // status 'incomplete' with reason 'max_output_tokens'. Best-effort: map that to
  // 'length', otherwise treat as complete (null).
  const truncated =
    data.status === 'incomplete' &&
    data.incomplete_details?.reason === 'max_output_tokens'
  return {
    content: data.output?.[0]?.content?.[0]?.text ?? '',
    finishReason: truncated ? 'length' : null,
  }
}

/** Test an OpenAI connection. */
export async function testOpenAI(
  cfg: OpenAIConfig,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await translateBatch(['hello'], 'zh-Hans', cfg, apiKey, undefined, 1)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
