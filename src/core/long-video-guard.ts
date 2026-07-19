import type {
  AutoTranslateLimitMinutes,
  TranslationMode,
} from '../settings'
import type { Cue } from '../subtitles/timedtext'

export interface CaptionScale {
  spanMs: number | null
  cueCount: number
  sourceCodePoints: number
  playerDurationMs?: number
}

export type LongVideoGuardReason = 'long-finite' | 'current-live'

export type LongVideoGuardEvaluation =
  | { action: 'allow'; scale: CaptionScale }
  | { action: 'guard'; reason: LongVideoGuardReason; scale: CaptionScale }

export type RequestRisk = 'low' | 'medium' | 'high'

export type TranslationActivationIntent = 'automatic' | 'manual' | 'force-retranslation'

export type TranslationPreflightAction =
  | 'continue'
  | 'skip-guard'
  | 'confirm-long-video'
  | 'show-live-notice'
  | 'confirm-force-retranslation'

/** Measure only the cleaned canonical source; inserted separators do not count. */
export function measureCaptionScale(
  cues: Cue[],
  playerDurationMs?: number,
): CaptionScale {
  let firstStart = Number.POSITIVE_INFINITY
  let lastEnd = Number.NEGATIVE_INFINITY
  let sourceCodePoints = 0

  for (const cue of cues) {
    sourceCodePoints += Array.from(cue.o).length
    if (!Number.isFinite(cue.s) || cue.s < 0) continue
    const duration = Number.isFinite(cue.d) ? Math.max(0, cue.d) : 0
    firstStart = Math.min(firstStart, cue.s)
    lastEnd = Math.max(lastEnd, cue.s + duration)
  }

  const finitePlayerDuration = finiteNonNegative(playerDurationMs)
  const spanMs = Number.isFinite(firstStart) && Number.isFinite(lastEnd)
    ? Math.max(0, lastEnd - firstStart)
    : null

  return {
    spanMs,
    cueCount: cues.length,
    sourceCodePoints,
    ...(finitePlayerDuration === undefined ? {} : { playerDurationMs: finitePlayerDuration }),
  }
}

export function evaluateLongVideoGuard(
  scale: CaptionScale,
  currentLive: boolean,
  limitMinutes: AutoTranslateLimitMinutes,
): LongVideoGuardEvaluation {
  if (currentLive) return { action: 'guard', reason: 'current-live', scale }
  if (limitMinutes === null) return { action: 'allow', scale }

  const effectiveSpan = scale.spanMs ?? scale.playerDurationMs
  return effectiveSpan !== undefined && effectiveSpan > limitMinutes * 60_000
    ? { action: 'guard', reason: 'long-finite', scale }
    : { action: 'allow', scale }
}

/** Qualitative warning only; never use this result for usage or CNY accounting. */
export function classifyRequestRisk(
  mode: TranslationMode,
  scale: Pick<CaptionScale, 'cueCount' | 'sourceCodePoints'>,
): RequestRisk {
  let score = mode === 'whole' ? 0 : mode === 'batch' ? 1 : 2
  if (scale.sourceCodePoints >= 120_000 || scale.cueCount >= 3_000) score += 2
  else if (scale.sourceCodePoints >= 50_000 || scale.cueCount >= 1_000) score += 1
  return score <= 0 ? 'low' : score === 1 ? 'medium' : 'high'
}

/** Central intent × playback policy; UI branches only execute this decision. */
export function selectTranslationPreflightAction(
  intent: TranslationActivationIntent,
  evaluation: LongVideoGuardEvaluation,
): TranslationPreflightAction {
  if (evaluation.action === 'guard') {
    if (intent === 'automatic') return 'skip-guard'
    return evaluation.reason === 'current-live'
      ? 'show-live-notice'
      : 'confirm-long-video'
  }
  return intent === 'force-retranslation' ? 'confirm-force-retranslation' : 'continue'
}

/** Only a manually confirmed new long-video attempt returns to guard on failure. */
export function shouldRestoreGuardAfterFailure(
  intent: TranslationActivationIntent,
  hadGuardedPreflight: boolean,
): boolean {
  return intent === 'manual' && hadGuardedPreflight
}

function finiteNonNegative(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}
