import { describe, expect, it } from 'vitest'
import type { Cue } from '../subtitles/timedtext'
import {
  classifyRequestRisk,
  evaluateLongVideoGuard,
  measureCaptionScale,
  selectTranslationPreflightAction,
  shouldRestoreGuardAfterFailure,
} from './long-video-guard'

describe('caption scale', () => {
  it('measures cleaned cue span and Unicode code points without synthetic separators', () => {
    const cues: Cue[] = [
      { s: 5_000, d: 1_000, o: 'A😀' },
      { s: 9_000, d: 2_000, o: '中文' },
    ]
    expect(measureCaptionScale(cues, 60_000)).toEqual({
      spanMs: 6_000,
      cueCount: 2,
      sourceCodePoints: 4,
      playerDurationMs: 60_000,
    })
  })

  it('falls back to player duration only when cue timing is unusable', () => {
    const scale = measureCaptionScale([
      { s: Number.NaN, d: 1_000, o: 'hello' },
    ], 3_600_000)
    expect(scale).toMatchObject({ spanMs: null, playerDurationMs: 3_600_000 })
  })
})

describe('long-video policy', () => {
  const scale = (spanMs: number | null, playerDurationMs?: number) => ({
    spanMs,
    cueCount: 1,
    sourceCodePoints: 5,
    ...(playerDurationMs === undefined ? {} : { playerDurationMs }),
  })

  it('allows an exact threshold and guards only a strictly longer caption span', () => {
    expect(evaluateLongVideoGuard(scale(45 * 60_000), false, 45).action).toBe('allow')
    expect(evaluateLongVideoGuard(scale(45 * 60_000 + 1), false, 45)).toMatchObject({
      action: 'guard',
      reason: 'long-finite',
    })
  })

  it('uses finite player duration only as a missing-caption-span fallback', () => {
    expect(evaluateLongVideoGuard(scale(30 * 60_000, 3 * 60 * 60_000), false, 45).action)
      .toBe('allow')
    expect(evaluateLongVideoGuard(scale(null, 3 * 60 * 60_000), false, 45).action)
      .toBe('guard')
  })

  it('allows unlimited finite replays but never current live playback', () => {
    expect(evaluateLongVideoGuard(scale(8 * 60 * 60_000), false, null).action).toBe('allow')
    expect(evaluateLongVideoGuard(scale(1_000), true, null)).toMatchObject({
      action: 'guard',
      reason: 'current-live',
    })
  })
})

describe('qualitative request risk', () => {
  it('combines strategy and exact source scale without claiming a request count', () => {
    const compact = { cueCount: 100, sourceCodePoints: 10_000 }
    const large = { cueCount: 1_188, sourceCodePoints: 42_000 }
    const veryLarge = { cueCount: 3_000, sourceCodePoints: 120_000 }

    expect(classifyRequestRisk('whole', compact)).toBe('low')
    expect(classifyRequestRisk('batch', compact)).toBe('medium')
    expect(classifyRequestRisk('sentence', compact)).toBe('high')
    expect(classifyRequestRisk('whole', large)).toBe('medium')
    expect(classifyRequestRisk('batch', large)).toBe('high')
    expect(classifyRequestRisk('whole', veryLarge)).toBe('high')
  })
})

describe('preflight intent matrix', () => {
  const scale = { spanMs: 4_000_000, cueCount: 100, sourceCodePoints: 10_000 }
  const allow = { action: 'allow' as const, scale }
  const long = { action: 'guard' as const, reason: 'long-finite' as const, scale }
  const live = { action: 'guard' as const, reason: 'current-live' as const, scale }

  it.each([
    ['automatic', allow, 'continue'],
    ['manual', allow, 'continue'],
    ['force-retranslation', allow, 'confirm-force-retranslation'],
    ['automatic', long, 'skip-guard'],
    ['manual', long, 'confirm-long-video'],
    ['force-retranslation', long, 'confirm-long-video'],
    ['automatic', live, 'skip-guard'],
    ['manual', live, 'show-live-notice'],
    ['force-retranslation', live, 'show-live-notice'],
  ] as const)('%s with %s chooses %s', (intent, evaluation, expected) => {
    expect(selectTranslationPreflightAction(intent, evaluation)).toBe(expected)
  })

  it('restores guard only after a manually confirmed new long-video failure', () => {
    expect(shouldRestoreGuardAfterFailure('manual', true)).toBe(true)
    expect(shouldRestoreGuardAfterFailure('manual', false)).toBe(false)
    expect(shouldRestoreGuardAfterFailure('automatic', true)).toBe(false)
    expect(shouldRestoreGuardAfterFailure('force-retranslation', true)).toBe(false)
  })
})
