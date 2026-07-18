import type { Cue } from '../subtitles/timedtext'
import { cacheKey } from '../cache/key'
import { getL1, putL1, type CacheEntry } from '../cache/l1'
import { readL2, writeL2 } from '../cache/l2github'
import {
  translateCues,
  type TranslationProgress,
} from '../translate/pipeline'
import { loadSettings, loadSecrets, normalizeTranslationSettings } from '../settings'
import type { Source } from './store'
import { normalizeLang } from '../translate/lang'
import type { TranslationContext } from '../translate/context'
import { UsageCollector } from '../usage/contracts'
import { calculateCostCny, resolvePricing } from '../usage/pricing'
import {
  appendUsageResponse,
  beginUsageOperation,
  finalizeUsageOperation,
} from '../usage/ledger'
import { sourceFingerprint, sourceIsCompatible } from '../cache/source'
import type { CaptionTrackKind } from '../subtitles/tracks'

export interface ResolveResult {
  cues: Cue[]
  source: Source
  artifact: CacheEntry
}

export interface ResolveOptions {
  signal?: AbortSignal
  onTranslating?: () => void
  /** Skip L1/L2 reads, but retain the normal full-success write sequence. */
  force?: boolean
  context?: TranslationContext
  onProgress?: (progress: TranslationProgress) => void
  getCurrentTime?: () => number
  track?: {
    languageCode: string
    kind: CaptionTrackKind
    vssId: string
  }
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
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const {
    signal,
    onTranslating,
    force = false,
    context,
    onProgress,
    getCurrentTime,
    track,
  } = options
  const settings = loadSettings()
  const secrets = loadSecrets()
  const tgt = normalizeLang(settings.tgt)
  const src = normalizeLang(srcLang)
  const key = cacheKey({ videoId, src, tgt })
  const keyInput = { videoId: videoId, src, tgt }
  const currentSourceFingerprint = await sourceFingerprint(cues)

  // 1. L1 lookup
  if (!force && !signal?.aborted) {
    const cached = await getL1(key)
    if (cached && await sourceIsCompatible(
      cues,
      cached.cues,
      cached.track?.sourceFingerprint,
    )) {
      console.log(`[Gistlate] L1 cache hit: ${key}`)
      return { cues: cached.cues, source: 'l1', artifact: cached }
    }
    if (cached) console.warn(`[Gistlate] Ignoring source-incompatible L1 entry: ${key}`)
  }

  // 2. L2 lookup
  if (!force && !signal?.aborted && settings.github.owner) {
    const fromL2 = await readL2(settings.github, keyInput)
    if (fromL2 && await sourceIsCompatible(
      cues,
      fromL2.cues,
      fromL2.track?.sourceFingerprint,
    )) {
      console.log(`[Gistlate] L2 cache hit: ${key}`)
      // Backfill L1 for faster future access
      await putL1(fromL2).catch(() => {})
      return { cues: fromL2.cues, source: 'l2', artifact: fromL2 }
    }
    if (fromL2) console.warn(`[Gistlate] Ignoring source-incompatible L2 entry: ${key}`)
  }

  // 3. Genuine translation — start an independent usage operation and run the
  // complete-sentence progressive pipeline. Cache hits never reach this point.
  console.log(`[Gistlate] Translating ${cues.length} cues: ${key}`)
  onTranslating?.()
  const translationSettings = normalizeTranslationSettings(settings.translation)
  const pricing = resolvePricing(settings.openai.baseUrl, settings.openai.model)
  let operationId: string | undefined

  try {
    const operation = await beginUsageOperation({
      videoId,
      src,
      tgt,
      baseUrl: settings.openai.baseUrl,
      model: settings.openai.model,
      force,
      strategy: {
        mode: translationSettings.mode,
        configuredBatchSize: translationSettings.batchSize,
      },
      pricing,
    })
    operationId = operation.operationId
  } catch (error) {
    // Usage history should not make subtitles unusable if IndexedDB is blocked.
    console.warn('[Gistlate] Usage ledger unavailable; continuing in memory', error)
  }

  const collector = new UsageCollector(async (stage, usage) => {
    if (!operationId) return
    try {
      await appendUsageResponse(operationId, stage, usage)
    } catch (error) {
      console.warn('[Gistlate] Usage ledger update failed', error)
    }
  })

  try {
    const translated = await translateCues(
      cues,
      tgt,
      settings.openai,
      secrets.openaiKey,
      {
        signal,
        context,
        translation: translationSettings,
        onProgress,
        getCurrentTime,
        onUsage: (stage, usage) => collector.record(stage, usage),
        sourceKind: track?.kind,
      },
    )

    // The model may finish at the same moment SPA navigation aborts this track.
    throwIfAborted(signal)
    await collector.flush()
    throwIfAborted(signal)
    const operationUsage = collector.snapshot()
    const costCny = calculateCostCny(operationUsage.tokens, pricing)

    // 4. One complete-only L1 write with backward-compatible generation metadata.
    const entry: CacheEntry = {
      key,
      videoId,
      src,
      tgt,
      model: settings.openai.model,
      cues: translated.cues,
      createdAt: Date.now(),
      video: context?.title ? { title: context.title } : undefined,
      track: track ? {
        languageCode: track.languageCode,
        kind: track.kind,
        vssId: track.vssId,
        sourceFingerprint: currentSourceFingerprint,
      } : undefined,
      generation: {
        strategy: {
          mode: translationSettings.mode,
          configuredBatchSize: translationSettings.batchSize,
          effectiveRequestCount: translated.diagnostics.translationRequestCount,
          concurrency: 8,
          temperature: 0,
          boundaryMethod: translated.diagnostics.boundaryMethod,
          boundaryRequestCount: translated.diagnostics.boundaryRequestCount,
          boundaryThinking: translated.diagnostics.boundaryMethod === 'llm' ? 'enabled' : 'not-used',
          translationThinking: 'disabled',
        },
        alignment: {
          requestCount: translated.diagnostics.alignmentRequestCount,
          fallbackSentenceCount: translated.diagnostics.fallbackSentenceCount,
        },
        usage: operationUsage,
        pricing,
        costCny,
      },
    }
    await putL1(entry)

    // 5. One L2 attempt (soft-fail: L1 already contains the complete result).
    throwIfAborted(signal)
    writeL2(settings.github, secrets.githubPat, entry, undefined, signal).catch(() => {})
    if (operationId) {
      await finalizeUsageOperation(operationId, 'success').catch((error) => {
        console.warn('[Gistlate] Usage ledger finalization failed', error)
      })
    }

    return { cues: translated.cues, source: 'fresh', artifact: entry }
  } catch (error) {
    await collector.flush().catch(() => {})
    if (operationId) {
      const status = signal?.aborted ? 'aborted' : 'failed'
      await finalizeUsageOperation(operationId, status, (error as Error).name).catch((ledgerError) => {
        console.warn('[Gistlate] Usage ledger finalization failed', ledgerError)
      })
    }
    throw error
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation resolution aborted')
}
