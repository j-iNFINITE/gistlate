import type { Cue } from '../subtitles/timedtext'
import type { OpenAIConfig } from '../settings'
import { translateBatch } from './openai'

/**
 * Translate a full set of cues (original text → translated text).
 *
 * Strategy:
 * 1. Chunk cues into batches (default 40 cues per batch).
 * 2. Run batches concurrently with a limited pool (default 4).
 * 3. Assert every cue gets a non-empty translation.
 * 4. Fail-closed: any batch failure after retries throws.
 *
 * All cues returned with `t` filled on success.
 */
export async function translateAllCues(
  cues: Cue[],
  targetLang: string,
  openaiCfg: OpenAIConfig,
  apiKey: string,
  batchSize = 40,
  concurrency = 4,
  signal?: AbortSignal,
): Promise<Cue[]> {
  if (cues.length === 0) return []

  // 1. Chunk
  const chunks: Cue[][] = []
  for (let i = 0; i < cues.length; i += batchSize) {
    chunks.push(cues.slice(i, i + batchSize))
  }

  // 2. Concurrent pool
  const results: Cue[][] = new Array(chunks.length)
  let nextIdx = 0

  async function worker(): Promise<void> {
    while (nextIdx < chunks.length) {
      const idx = nextIdx++
      const chunk = chunks[idx]
      if (signal?.aborted) throw new Error('Translation pipeline aborted')

      const texts = chunk.map((c) => c.o)
      const translated = await translateBatch(
        texts,
        targetLang,
        openaiCfg,
        apiKey,
        signal,
      )

      // Merge translations back into cues
      results[idx] = chunk.map((c, i) => ({
        ...c,
        t: translated[i],
      }))
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker())
  await Promise.all(workers)

  // 3. Flatten and validate
  const all = results.flat()
  const missing = all.filter((c) => !c.t || c.t.trim() === '')
  if (missing.length > 0) {
    throw new Error(
      `Translation pipeline: ${missing.length} cues have empty translations (first missing: "${missing[0].o}")`,
    )
  }

  return all
}
