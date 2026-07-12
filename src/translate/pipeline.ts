import type { Cue } from '../subtitles/timedtext'
import type { OpenAIConfig } from '../settings'
import { translateBatch, boundaryBatch, isSplittable, TruncationError } from './openai'
import {
  parseBoundaries,
  groupByBoundaries,
  sentencesToCues,
} from './segment'

/**
 * Below this many lines we stop splitting and let a genuine failure propagate
 * (fail-closed). Prevents thrashing on tiny ranges a model still can't satisfy.
 */
const MIN_SPLIT = 8
/**
 * Hard recursion cap; bounds worst-case request fan-out on a pathological
 * model. At depth 6 a whole-video range has already been halved six times.
 */
const MAX_DEPTH = 6
/** Retries for a malformed / transient pass-1 boundary response before giving up. */
const BOUNDARY_RETRIES = 2

/**
 * Translate a full set of cues into sentence-level cues (two-pass).
 *
 * Pass 1 (`detectBoundaries`): ask the model, for each fragment, whether it ends
 * a sentence; group the per-fragment flags deterministically into contiguous
 * sentence ranges. Pass 2 (`translateRange`): translate the joined sentence
 * texts 1:1 (adaptive split on truncation). Building each cue's `o`, `t`, and
 * time from the SAME fragment range makes the translation aligned by
 * construction — an imperfect boundary at worst shifts a seam, never mis-times a
 * translation.
 *
 * On any unrecoverable failure of either pass (malformed boundaries, transport,
 * truncation below the split floor) — but NOT on abort — fall back to the
 * existing 1:1 fragment translation so the result is never worse than before.
 * Fail-closed: an unrecoverable failure throws (no partial result); the caller
 * writes nothing. Abort propagates without falling back or writing.
 */
export async function translateAllCues(
  cues: Cue[],
  targetLang: string,
  openaiCfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Cue[]> {
  if (cues.length === 0) return []

  try {
    // Pass 1: per-fragment sentence boundaries (reliable, 1:1), then group.
    const isEnd = await detectBoundaries(cues, openaiCfg, apiKey, signal)
    const ranges = groupByBoundaries(isEnd)

    // Pass 2: translate the whole sentences (reuse the proven 1:1 range
    // translator — count-validated, adaptive split on truncation).
    const sentenceTexts = ranges.map((r) =>
      cues
        .slice(r.startIdx, r.endIdx + 1)
        .map((c) => c.o)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    const translations = await translateRange(
      sentenceTexts,
      targetLang,
      openaiCfg,
      apiKey,
      signal,
    )

    return sentencesToCues(cues, ranges, translations)
  } catch (e) {
    // Never fall back on abort — the result would be stale and discarded anyway.
    if (signal?.aborted) throw e

    console.warn('[Gistlate] Sentence reconstruction failed; falling back to 1:1', e)

    const translated = await translateRange(
      cues.map((c) => c.o),
      targetLang,
      openaiCfg,
      apiKey,
      signal,
    )
    const out = cues.map((c, i) => ({ ...c, t: translated[i] }))
    if (out.some((c) => !c.t || c.t.trim() === '')) {
      throw new Error('Translation pipeline: empty translations in fallback')
    }
    return out
  }
}

/**
 * Pass 1. Ask the model, for each fragment, whether it ends a sentence; parse to
 * a boolean end-flag array aligned 1:1 with `cues`. Retries on a malformed
 * response (`SegmentationError`) or a transient transport error, with backoff.
 *
 * There is NO adaptive split for pass 1: the E/C output is tiny, so a truncation
 * (`finish_reason==='length'`) signals a misbehaving model rather than an
 * oversized range — it propagates immediately (caller falls back to 1:1) instead
 * of burning retries. Abort propagates immediately.
 */
async function detectBoundaries(
  cues: Cue[],
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<boolean[]> {
  const fragTexts = cues.map((c) => c.o)
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= BOUNDARY_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Translation pipeline aborted')

    try {
      const { content, finishReason } = await boundaryBatch(fragTexts, cfg, apiKey, signal)
      if (finishReason === 'length') {
        throw new TruncationError(`Boundary output truncated for ${cues.length} fragments`)
      }
      return parseBoundaries(content, cues.length)
    } catch (e) {
      if (signal?.aborted) throw e
      // Truncation won't improve on retry, and pass 1 has no split — propagate
      // so the caller falls back to 1:1.
      if (e instanceof TruncationError) throw e

      lastError = e as Error
      if (attempt < BOUNDARY_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
        continue
      }
      throw lastError
    }
  }

  throw lastError ?? new Error('Boundary detection failed')
}

/**
 * Translate a range of raw text lines (used for both pass-2 sentence texts and
 * the 1:1 fallback). Tries the whole range in one request; on an output-size
 * failure (truncation / count mismatch) it splits the range in half and
 * recurses, concatenating the halves. Any non-splittable error, or a failure
 * below the MIN_SPLIT / MAX_DEPTH floor, propagates (fail-closed).
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
