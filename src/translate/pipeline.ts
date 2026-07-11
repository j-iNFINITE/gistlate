import type { Cue } from '../subtitles/timedtext'
import type { OpenAIConfig } from '../settings'
import { translateBatch, segmentBatch, isSplittable, TruncationError } from './openai'
import { parseSentences, sentencesToCues, type Sentence } from './segment'

/**
 * Below this many lines/fragments we stop splitting and let a genuine failure
 * propagate (fail-closed). Prevents thrashing on tiny ranges that a model still
 * can't satisfy.
 */
const MIN_SPLIT = 8
/**
 * Hard recursion cap; bounds worst-case request fan-out on a pathological
 * model. At depth 6 a whole-video range has already been halved six times.
 */
const MAX_DEPTH = 6
/** Retries for a malformed (bad-coverage) segmentation before giving up. */
const SEGMENT_RETRIES = 2

/**
 * Translate a full set of cues into sentence-level cues.
 *
 * Strategy (one-pass segment + translate with a safe fallback):
 * 1. Ask the model to group consecutive fragments into complete sentences and
 *    translate each in a single pass (`segmentRange`), validating full 1..N
 *    coverage. On truncation the range is halved and re-segmented (adaptive).
 * 2. On any unrecoverable segmentation failure (malformed output, network, or a
 *    truncation below the split floor) — but NOT on abort — fall back to the
 *    existing 1:1 fragment translation so the result is never worse than before.
 * 3. Fail-closed: an unrecoverable failure throws (no partial result); the caller
 *    writes nothing to L1/L2. Abort propagates without falling back or writing.
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
    const sentences = await segmentRange(cues, targetLang, openaiCfg, apiKey, signal)
    return sentencesToCues(cues, sentences)
  } catch (e) {
    // Never fall back on abort — the result would be stale and discarded anyway.
    if (signal?.aborted) throw e

    console.warn('[Gistlate] Sentence segmentation failed; falling back to 1:1', e)

    const texts = cues.map((c) => c.o)
    const translated = await translateRange(texts, targetLang, openaiCfg, apiKey, signal)
    const out = cues.map((c, i) => ({ ...c, t: translated[i] }))
    const missing = out.filter((c) => !c.t || c.t.trim() === '')
    if (missing.length > 0) {
      throw new Error(
        `Translation pipeline: ${missing.length} cues have empty translations (first missing: "${missing[0].o}")`,
      )
    }
    return out
  }
}

/**
 * Segment + translate a fragment range in one request. On a malformed response
 * (`SegmentationError`) or a transient transport error, retry with backoff up to
 * `SEGMENT_RETRIES`. On truncation (`finish_reason==='length'`) split the range
 * in half, segment each half, and offset the right half's indices back into the
 * full range (a sentence straddling the split may be cut — acceptable). Below the
 * `MIN_SPLIT` / `MAX_DEPTH` floors, or after exhausting retries, throw so the
 * caller falls back to 1:1.
 */
async function segmentRange(
  frags: Cue[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
  depth = 0,
): Promise<Sentence[]> {
  if (frags.length === 0) return []

  const n = frags.length
  const fragTexts = frags.map((f) => f.o)

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= SEGMENT_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Translation pipeline aborted')

    try {
      const { content, finishReason } = await segmentBatch(
        fragTexts,
        targetLang,
        cfg,
        apiKey,
        signal,
      )
      // Truncation is deterministic for this input — surface it so we split.
      if (finishReason === 'length') {
        throw new TruncationError(`Segmentation output truncated for ${n} fragments`)
      }
      return parseSentences(content, n)
    } catch (e) {
      if (signal?.aborted) throw e

      // Output-size failure: split the fragment range and re-segment each half,
      // while there is still room to split. Otherwise fail (caller falls back).
      if (e instanceof TruncationError) {
        if (n <= MIN_SPLIT || depth >= MAX_DEPTH) throw e
        return splitAndSegment(frags, targetLang, cfg, apiKey, signal, depth)
      }

      // Malformed coverage or transient transport error: retry, then give up.
      lastError = e as Error
      if (attempt < SEGMENT_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
        continue
      }
      throw lastError
    }
  }

  throw lastError ?? new Error('Segmentation failed')
}

/** Halve the fragment range, segment each half, and stitch the indices back. */
async function splitAndSegment(
  frags: Cue[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  depth: number,
): Promise<Sentence[]> {
  const mid = Math.ceil(frags.length / 2)
  const left = await segmentRange(frags.slice(0, mid), targetLang, cfg, apiKey, signal, depth + 1)
  const right = await segmentRange(frags.slice(mid), targetLang, cfg, apiKey, signal, depth + 1)
  // Right-half indices are local to its sub-range; shift them into the full range.
  const offsetRight = right.map((s) => ({
    ...s,
    startIdx: s.startIdx + mid,
    endIdx: s.endIdx + mid,
  }))
  return [...left, ...offsetRight]
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
