import type { Cue } from './timedtext'

/**
 * Find the cue that covers `timeMs`.
 * Returns `undefined` if no matching cue.
 */
export function findCueAt(cues: Cue[], timeMs: number): Cue | undefined {
  const index = findCueIndexAt(cues, timeMs)
  return index >= 0 ? cues[index] : undefined
}

/** Find the canonical cue index covering `timeMs`, or -1 between cues. */
export function findCueIndexAt(cues: Cue[], timeMs: number): number {
  // Binary search since cues are ordered by start time
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const c = cues[mid]
    if (timeMs < c.s) {
      hi = mid - 1
    } else if (timeMs >= c.s + c.d) {
      lo = mid + 1
    } else {
      return mid
    }
  }
  return -1
}

/**
 * Get cues that are near `timeMs` and have no translation yet.
 * Returns up to `windowSize` / 2 around the current time.
 * Used to decide what to translate.
 */
export function getCuesToTranslate(
  cues: Cue[],
  timeMs: number,
  windowSize = 10,
): Cue[] {
  const idx = cues.findIndex((c) => c.s <= timeMs && timeMs < c.s + c.d)
  if (idx === -1) return []

  const half = Math.floor(windowSize / 2)
  const start = Math.max(0, idx - half)
  const end = Math.min(cues.length, idx + half)
  return cues.slice(start, end).filter((c) => !c.t)
}

/**
 * Check whether any cue in the window around `timeMs` lacks a translation,
 * meaning we should trigger a translation call.
 */
export function shouldTriggerTranslation(
  cues: Cue[],
  timeMs: number,
  windowSize = 10,
): boolean {
  return getCuesToTranslate(cues, timeMs, windowSize).length > 0
}
