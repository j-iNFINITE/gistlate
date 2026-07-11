import type { Cue } from '../subtitles/timedtext'
import type { OpenAIConfig } from '../settings'
import { translateBatch, isSplittable } from './openai'

/**
 * Below this many lines we stop splitting and let a genuine failure propagate
 * (fail-closed). Prevents thrashing on tiny ranges that a model still can't
 * satisfy.
 */
const MIN_SPLIT = 8
/**
 * Hard recursion cap; bounds worst-case request fan-out on a pathological
 * model. At depth 6 a whole-video range has already been halved six times.
 */
const MAX_DEPTH = 6

/**
 * Translate a full set of cues (original text → translated text).
 *
 * Strategy (one-shot with adaptive fallback):
 * 1. Translate the WHOLE cue list in a single request — full-video context gives
 *    coherent, terminology-consistent output, and the system prompt is sent once
 *    (cheapest). A large-output model (e.g. DeepSeek V4, 384K) needs only this.
 * 2. If the model truncates its output (finish_reason 'length') or returns the
 *    wrong line count, split the range in half and translate each half,
 *    recursively, down to MIN_SPLIT / MAX_DEPTH. This adapts to small-output
 *    models with no hardcoded token caps.
 * 3. Assert every cue gets a non-empty translation.
 * 4. Fail-closed: any unrecoverable failure throws (no partial result); the
 *    caller writes nothing to L1/L2.
 */
export async function translateAllCues(
  cues: Cue[],
  targetLang: string,
  openaiCfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Cue[]> {
  if (cues.length === 0) return []

  const texts = cues.map((c) => c.o)
  const translated = await translateRange(texts, targetLang, openaiCfg, apiKey, signal)

  // Merge translations back into cues and enforce the write-on-success invariant.
  const out = cues.map((c, i) => ({ ...c, t: translated[i] }))
  const missing = out.filter((c) => !c.t || c.t.trim() === '')
  if (missing.length > 0) {
    throw new Error(
      `Translation pipeline: ${missing.length} cues have empty translations (first missing: "${missing[0].o}")`,
    )
  }

  return out
}

/**
 * Translate a range of raw text lines. Tries the whole range in one request;
 * on an output-size failure (truncation / count mismatch) it splits the range
 * in half and recurses, concatenating the halves. Any non-splittable error, or
 * a failure below the MIN_SPLIT / MAX_DEPTH floor, propagates (fail-closed).
 */
async function translateRange(
  texts: string[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
  depth = 0,
): Promise<string[]> {
  if (texts.length === 0) return []
  if (signal?.aborted) throw new Error('Translation pipeline aborted')

  try {
    return await translateBatch(texts, targetLang, cfg, apiKey, signal)
  } catch (e) {
    // Only split on an output-size problem, and only while there is still room
    // to split. Otherwise fail closed so the caller shows original-only.
    if (!isSplittable(e) || texts.length <= MIN_SPLIT || depth >= MAX_DEPTH) {
      throw e
    }
    const mid = Math.ceil(texts.length / 2)
    const left = await translateRange(
      texts.slice(0, mid),
      targetLang,
      cfg,
      apiKey,
      signal,
      depth + 1,
    )
    const right = await translateRange(
      texts.slice(mid),
      targetLang,
      cfg,
      apiKey,
      signal,
      depth + 1,
    )
    return [...left, ...right]
  }
}
