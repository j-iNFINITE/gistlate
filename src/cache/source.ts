import type { Cue } from '../subtitles/timedtext'
import { GAP_TOLERANCE } from '../translate/segment'

const FINGERPRINT_VERSION = 'sha256-v1'
const TIMELINE_TOLERANCE_MS = 600

/** Normalize cue regrouping without discarding word or punctuation distinctions. */
export function normalizedSourceText(cues: Cue[]): string {
  return cues
    .map((cue) => cue.o)
    .join(' ')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
}

export async function sourceFingerprint(cues: Cue[]): Promise<string> {
  const bytes = new TextEncoder().encode(normalizedSourceText(cues))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `${FINGERPRINT_VERSION}:${hex}`
}

/**
 * New artifacts compare their recorded source fingerprint. Old artifacts derive
 * it from persisted original text so existing pool files remain safely usable.
 */
export async function sourceIsCompatible(
  currentSource: Cue[],
  cachedCues: Cue[],
  recordedFingerprint?: string,
): Promise<boolean> {
  try {
    const current = await sourceFingerprint(currentSource)
    const textMatches = recordedFingerprint
      ? recordedFingerprint === current
      : await sourceFingerprint(cachedCues).then((cached) => cached === current)
    return textMatches && sourceTimelineIsCompatible(currentSource, cachedCues)
  } catch {
    return false
  }
}

/**
 * Partition persisted display cues back onto the current contiguous source
 * fragments, then verify the timing Gistlate would derive today. This rejects a
 * same-text artifact from a differently timed manual/ASR track.
 */
export function sourceTimelineIsCompatible(currentSource: Cue[], cachedCues: Cue[]): boolean {
  if (currentSource.length === 0 || cachedCues.length === 0) {
    return currentSource.length === cachedCues.length
  }

  const ranges: Array<{ start: number; end: number; cue: Cue }> = []
  let sourceIndex = 0
  for (const cached of cachedCues) {
    if (!cached || typeof cached.o !== 'string') return false
    const target = normalizedCueText(cached.o)
    if (!target || sourceIndex >= currentSource.length) return false
    const start = sourceIndex
    let accumulated = ''
    let matched = false
    while (sourceIndex < currentSource.length) {
      const sourceCue = currentSource[sourceIndex]
      if (!sourceCue || typeof sourceCue.o !== 'string') return false
      accumulated = normalizedCueText(`${accumulated} ${sourceCue.o}`)
      sourceIndex += 1
      if (accumulated === target) {
        matched = true
        break
      }
      if (!target.startsWith(`${accumulated} `)) return false
    }
    if (!matched) return false
    ranges.push({ start, end: sourceIndex - 1, cue: cached })
  }
  if (sourceIndex !== currentSource.length) return false

  return ranges.every((range, index) => {
    const first = currentSource[range.start]
    const last = currentSource[range.end]
    const nextStart = ranges[index + 1]
      ? currentSource[ranges[index + 1].start].s
      : undefined
    const rawEnd = last.s + last.d
    const expectedEnd = nextStart === undefined
      ? rawEnd
      : Math.min(nextStart, rawEnd + GAP_TOLERANCE)
    const cachedEnd = range.cue.s + range.cue.d
    return Math.abs(range.cue.s - first.s) <= TIMELINE_TOLERANCE_MS &&
      Math.abs(cachedEnd - expectedEnd) <= TIMELINE_TOLERANCE_MS
  })
}

function normalizedCueText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}
