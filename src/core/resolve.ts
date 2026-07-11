import type { Cue } from '../subtitles/timedtext'
import { cacheKey } from '../cache/key'
import { getL1, putL1, type CacheEntry } from '../cache/l1'
import { readL2, writeL2 } from '../cache/l2github'
import { translateAllCues } from '../translate/pipeline'
import { loadSettings, loadSecrets } from '../settings'
import type { Source } from './store'
import { normalizeLang } from '../translate/lang'

export interface ResolveResult {
  cues: Cue[]
  source: Source
}

/**
 * Core orchestration: L1 → L2 → translate → putL1 → writeL2.
 *
 * Guarantees:
 * - Cache hit returns cues with all `t` filled.
 * - Cache miss translates full track, persists to L1, attempts L2 (soft-fail).
 * - Throws on translation failure (no partial L2 write).
 */
export async function resolveTranslation(
  videoId: string,
  srcLang: string,
  cues: Cue[],
  signal?: AbortSignal,
  onTranslating?: () => void,
): Promise<ResolveResult> {
  const settings = loadSettings()
  const secrets = loadSecrets()
  const tgt = normalizeLang(settings.tgt)
  const src = normalizeLang(srcLang)
  const key = cacheKey({ videoId, src, tgt })
  const keyInput = { videoId: videoId, src, tgt }

  // 1. L1 lookup
  if (!signal?.aborted) {
    const cached = await getL1(key)
    if (cached) {
      console.log(`[Gistlate] L1 cache hit: ${key}`)
      return { cues: cached.cues, source: 'l1' }
    }
  }

  // 2. L2 lookup
  if (!signal?.aborted && settings.github.owner) {
    const fromL2 = await readL2(settings.github, keyInput)
    if (fromL2) {
      console.log(`[Gistlate] L2 cache hit: ${key}`)
      // Backfill L1 for faster future access
      await putL1(fromL2).catch(() => {})
      return { cues: fromL2.cues, source: 'l2' }
    }
  }

  // 3. Cache miss — translate everything in one shot (adaptive fallback inside).
  console.log(`[Gistlate] Translating ${cues.length} cues: ${key}`)
  onTranslating?.() // only fires on a genuine translation (not cache hits)
  const translated = await translateAllCues(
    cues,
    tgt,
    settings.openai,
    secrets.openaiKey,
    signal,
  )

  // 4. Write to L1
  const entry: CacheEntry = {
    key,
    videoId,
    src,
    tgt,
    model: settings.openai.model,
    cues: translated,
    createdAt: Date.now(),
  }
  await putL1(entry)

  // 5. Write to L2 (soft-fail: L1 already has it)
  writeL2(settings.github, secrets.githubPat, entry).catch(() => {})

  return { cues: translated, source: 'fresh' }
}
