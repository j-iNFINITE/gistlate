import { gmFetch } from '../net/gm'
import { fillPrompt, parseNumbered } from './prompt'
import type { OpenAIConfig } from '../settings'

const NEW_MODELS = new Set([
  'gpt-5-nano', 'gpt-5', 'gpt-5-mini', 'o1', 'o3-mini', 'o4-mini', 'o3',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-pro',
])

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
): Promise<string[]> {
  if (texts.length === 0) return []

  const { system, user } = fillPrompt(texts, targetLang)

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

      return parseNumbered(result, texts.length)
    } catch (e) {
      lastError = e as Error
      if (signal?.aborted) throw lastError
      // Backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }

  throw lastError ?? new Error('Translation failed after retries')
}

async function callChatAPI(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
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
  return data.choices?.[0]?.message?.content ?? ''
}

async function callResponsesAPI(
  system: string,
  user: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
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
  return data.output?.[0]?.content?.[0]?.text ?? ''
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
