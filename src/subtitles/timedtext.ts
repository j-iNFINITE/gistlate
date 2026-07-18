/**
 * YouTube timedtext API types and parser.
 * Based on the public YouTube `/api/timedtext` response JSON format.
 */
import { isSentenceMark, leadingSentenceMarks } from './sentence-marks'

// ── Raw API types ────────────────────────────────────

export interface TimedtextSegment {
  utf8: string
  /** Word-level offset within the parent event (ASR). */
  tOffsetMs?: number
  /** ASR confidence. */
  acAsrConf?: number
}

export interface TimedtextEvent {
  tStartMs: number
  dDurationMs?: number
  /** Caption line segments (1 segment for manual captions, ~1 per word for ASR). */
  segs?: TimedtextSegment[]
  /** When 1, this event is a continuation of the previous window. */
  wWinId?: 1
  /** When 1, appended text belongs to the same line as the previous event. */
  aAppend?: 1
}

export interface GetTimedtextResp {
  events: TimedtextEvent[]
}

// ── Internal cue (compact, minified key names) ──────

export interface Cue {
  /** startMs */
  s: number
  /** durationMs */
  d: number
  /** Original text */
  o: string
  /** Translated text (filled after translation / cache) */
  t?: string
  /**
   * Deterministic source-side sentence boundary recovered from timed ASR
   * punctuation. Internal source cues may carry it; persisted translated cues
   * intentionally omit it.
   */
  sentenceEnd?: boolean
}

// ── Parse ─────────────────────────────────────────────

/**
 * Convert a raw timedtext response to Cue[].
 *
 * Manual captions: each event is one line → one Cue.
 * Auto-generated (ASR): each event may have word-level segs; group consecutive
 * segs into sentence-ish cues. ASR events often lack dDurationMs; window id
 * and append markers indicate continuation.
 */
export function parseTimedtext(resp: GetTimedtextResp): Cue[] {
  const events = resp.events
  if (!events || events.length === 0) return []

  if (hasUsableWordTiming(events)) return parseWordTimedEvents(events)

  return parseLegacyEvents(events)
}

/** Keep the established manual-caption and untimed-ASR behavior unchanged. */
function parseLegacyEvents(events: TimedtextEvent[]): Cue[] {
  // First pass: join aAppend continuations and wWinId windows
  const merged: TimedtextEvent[] = []
  for (const ev of events) {
    // Skip pure window continuation events with no text content
    if (!ev.segs || ev.segs.length === 0) continue

    if (ev.aAppend === 1 && merged.length > 0) {
      // This event's text belongs to the previous line
      const last = merged[merged.length - 1]
      last.segs = (last.segs ?? []).concat(ev.segs)
      last.dDurationMs = ev.tStartMs + (ev.dDurationMs ?? 0) - last.tStartMs
    } else {
      merged.push({ ...ev, segs: [...(ev.segs ?? [])] })
    }
  }

  // Second pass: build cues
  const cues: Cue[] = []
  for (const ev of merged) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8)
      .join('')
      .trim()
    if (!text) continue

    const duration = ev.dDurationMs ?? estimateDuration(merged, ev)
    cues.push({ s: ev.tStartMs, d: duration, o: text })
  }

  return cues
}

interface TimedFragment {
  s: number
  o: string
  sentenceEnd: boolean
}

const WORD_TIMING_MIN_RATIO = 0.6

/**
 * Select the word-timed path only when offsets are clearly a track-level ASR
 * feature. A single incidental zero offset on a manual line is not enough.
 */
function hasUsableWordTiming(events: TimedtextEvent[]): boolean {
  let visibleSegments = 0
  let timedSegments = 0
  let multiSegmentEvent = false

  for (const event of events) {
    const segments = (event.segs ?? []).filter((segment) => hasVisibleText(segment.utf8))
    if (segments.length > 1) multiSegmentEvent = true
    for (const segment of segments) {
      visibleSegments += 1
      if (isValidOffset(segment.tOffsetMs)) timedSegments += 1
    }
  }

  return multiSegmentEvent && timedSegments >= 2 &&
    timedSegments / visibleSegments >= WORD_TIMING_MIN_RATIO
}

/**
 * Recover Google ASR sentence boundaries without asking the model to infer
 * boundaries that already exist in the timed punctuation stream.
 */
function parseWordTimedEvents(events: TimedtextEvent[]): Cue[] {
  const fragments: TimedFragment[] = []
  let trackEnd = 0

  for (const event of events) {
    const segments = event.segs ?? []
    const visibleText = segments.map((segment) => segment.utf8).join('')
    if (!hasVisibleText(visibleText)) continue

    const eventEnd = event.tStartMs + (event.dDurationMs ?? 4000)
    trackEnd = Math.max(trackEnd, eventEnd)
    const offsets = inferOffsets(segments)
    let fragmentText = ''
    let fragmentStart: number | undefined

    const appendFragment = (sentenceEnd: boolean): void => {
      const text = fragmentText.trim()
      if (text && fragmentStart !== undefined) {
        fragments.push({ s: fragmentStart, o: text, sentenceEnd })
      }
      fragmentText = ''
      fragmentStart = undefined
    }

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      if (!hasVisibleText(segment.utf8) && /^\s*$/u.test(segment.utf8)) {
        // Preserve ordinary spaces inside a fragment, but ignore the pure
        // newline append events used only to roll Google's caption window.
        if (!/[\r\n]/u.test(segment.utf8) && fragmentText) fragmentText += segment.utf8
        continue
      }

      let text = segment.utf8.replace(/[\r\n]+/gu, '')
      if (!text) continue
      const tokenStart = event.tStartMs + offsets[index]

      // Google sometimes emits the full stop as the first token of the next
      // event. It closes the preceding fragment and must not start a new cue.
      if (fragmentText === '' && fragments.length > 0) {
        const leadingMarks = leadingSentenceMarks(text)
        const previous = fragments[fragments.length - 1]
        if (leadingMarks) {
          previous.o += leadingMarks
          previous.sentenceEnd = true
          text = text.slice(leadingMarks.length)
          if (!text) continue
        }
      }

      if (fragmentStart === undefined) fragmentStart = tokenStart
      const codePoints = Array.from(text)
      for (let charIndex = 0; charIndex < codePoints.length; charIndex++) {
        const char = codePoints[charIndex]
        fragmentText += char
        if (isSentenceBreak(codePoints, charIndex)) {
          appendFragment(true)
          if (charIndex < codePoints.length - 1) {
            // No true intra-token timing exists. Keep ordering deterministic;
            // the following token normally supplies the next precise start.
            fragmentStart = tokenStart + 1
          }
        }
      }
    }

    // Event boundaries remain legal display boundaries even when the sentence
    // continues into the next event.
    appendFragment(false)
  }

  if (fragments.length === 0) return []
  fragments[fragments.length - 1].sentenceEnd = true

  // Enforce a strictly increasing, gap-free timed sequence. JSON3 offsets are
  // normally monotonic, but this also makes malformed equal offsets harmless.
  for (let index = 1; index < fragments.length; index++) {
    fragments[index].s = Math.max(fragments[index].s, fragments[index - 1].s + 1)
  }

  return fragments.map((fragment, index): Cue => {
    const nextStart = fragments[index + 1]?.s
    const end = nextStart ?? Math.max(trackEnd, fragment.s + 1)
    return {
      s: fragment.s,
      d: Math.max(1, end - fragment.s),
      o: fragment.o,
      sentenceEnd: fragment.sentenceEnd,
    }
  })
}

function hasVisibleText(value: string): boolean {
  return value.replace(/[\r\n]/gu, '').trim().length > 0
}

function isValidOffset(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSentenceBreak(codePoints: string[], index: number): boolean {
  const char = codePoints[index]
  if (!isSentenceMark(char)) return false
  const next = codePoints[index + 1]
  if (next && isSentenceMark(next)) return false
  // A period inside a decimal/version token is not a sentence boundary.
  if (char === '.' && next && /[\p{L}\p{N}]/u.test(next)) return false
  return true
}

/** Infer the few missing offsets without changing explicit Google timings. */
function inferOffsets(segments: TimedtextSegment[]): number[] {
  const offsets: Array<number | undefined> = segments.map((segment) =>
    isValidOffset(segment.tOffsetMs) ? segment.tOffsetMs : undefined,
  )
  const steps: number[] = []
  let previousKnown: number | undefined
  let previousKnownIndex = -1
  for (let index = 0; index < offsets.length; index++) {
    const value = offsets[index]
    if (value === undefined) continue
    if (previousKnown !== undefined && value > previousKnown) {
      steps.push((value - previousKnown) / (index - previousKnownIndex))
    }
    previousKnown = value
    previousKnownIndex = index
  }
  const typicalStep = median(steps) ?? 200

  if (offsets[0] === undefined) offsets[0] = 0
  let index = 0
  while (index < offsets.length) {
    if (offsets[index] !== undefined) {
      index += 1
      continue
    }
    const gapStart = index
    while (index < offsets.length && offsets[index] === undefined) index += 1
    const leftIndex = gapStart - 1
    const left = offsets[leftIndex] ?? 0
    const right = index < offsets.length ? offsets[index] : undefined
    const count = index - gapStart
    for (let gapIndex = 0; gapIndex < count; gapIndex++) {
      offsets[gapStart + gapIndex] = right === undefined
        ? left + typicalStep * (gapIndex + 1)
        : left + (right - left) * ((gapIndex + 1) / (count + 1))
    }
  }

  return offsets.map((value) => Math.max(0, Math.round(value ?? 0)))
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/**
 * Estimate duration for events missing dDurationMs (common in ASR tracks).
 * If next event exists, use gap; otherwise a conservative default.
 */
function estimateDuration(events: TimedtextEvent[], ev: TimedtextEvent): number {
  const idx = events.indexOf(ev)
  if (idx < events.length - 1) {
    const next = events[idx + 1]
    // Cap at reasonable max for a subtitle cue
    return Math.min(next.tStartMs - ev.tStartMs, 8000)
  }
  return 4000
}
