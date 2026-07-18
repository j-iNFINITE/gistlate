import type { Cue } from '../subtitles/timedtext'

/**
 * One reconstructed sentence: a contiguous, inclusive run of fragments
 * (0-based indices into the fragment array). Internal only — never stored;
 * ranges are converted to `Cue`s once their sentence translations are ready.
 */
export interface SentenceRange {
  /** 0-based index of the first fragment (inclusive). */
  startIdx: number
  /** 0-based index of the last fragment (inclusive). */
  endIdx: number
}

/**
 * Thrown when boundary detection or deterministic range construction does not
 * cleanly cover fragments 1..N. The pipeline retries model output, then fails
 * closed rather than caching a semantically shifted fragment fallback.
 */
export class SegmentationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SegmentationError'
  }
}

/**
 * Parse pass-1 boundary output — one `[<n>] E` / `[<n>] C` line per fragment —
 * into an end-flag array `isEnd[0..n-1]` (`true` = fragment n ends a sentence).
 *
 * Lines that do not match the expected shape (blank lines, stray prose) are
 * ignored. Every fragment 1..N must be present, else `SegmentationError`. The
 * last fragment is forced to end (`isEnd[n-1] = true`) so the final sentence
 * always closes regardless of what the model reported.
 */
export function parseBoundaries(output: string, n: number): boolean[] {
  const isEnd: (boolean | undefined)[] = new Array(n).fill(undefined)

  for (const line of output.split('\n')) {
    const m = line.match(/^\s*\[(\d+)\]\s*([EC])\b/)
    if (!m) continue
    const idx = Number.parseInt(m[1], 10) - 1
    if (idx < 0 || idx >= n) continue
    if (isEnd[idx] !== undefined) {
      throw new SegmentationError(`Boundary detection duplicated fragment: ${idx + 1}`)
    }
    isEnd[idx] = m[2] === 'E'
  }

  const missing = isEnd
    .map((v, i) => (v === undefined ? i + 1 : null))
    .filter((i): i is number => i !== null)

  if (missing.length > 0) {
    throw new SegmentationError(
      `Boundary detection missing fragments: [${missing.join(', ')}]`,
    )
  }

  const flags = isEnd as boolean[]
  // The last fragment always ends the final sentence, even if the model said C.
  flags[n - 1] = true
  return flags
}

/**
 * Group per-fragment end flags into contiguous sentence ranges. A range closes
 * at each `true`. Because every index 0..n-1 lands in exactly one range, the
 * result is full, gap-free, in-order coverage by construction. An all-`false`
 * array (e.g. passed directly in a test) yields one sentence spanning all
 * fragments.
 */
export function groupByBoundaries(isEnd: boolean[]): SentenceRange[] {
  const ranges: SentenceRange[] = []
  let start = 0
  for (let i = 0; i < isEnd.length; i++) {
    if (isEnd[i]) {
      ranges.push({ startIdx: start, endIdx: i })
      start = i + 1
    }
  }
  // Close any trailing run whose final flag was not an end. `parseBoundaries`
  // forces the last flag true, so this only matters for direct callers.
  if (start < isEnd.length) {
    ranges.push({ startIdx: start, endIdx: isEnd.length - 1 })
  }
  return ranges
}

/** Display-length targets. Kept internal to the product rather than settings. */
export const SPACE_WORD_TARGET = 15
export const CJK_VISIBLE_CHAR_TARGET = 30

const NATURAL_BOUNDARY_MIN_RATIO = 0.6
const NATURAL_BOUNDARY_MAX_RATIO = 1.25
const PAUSE_PREFERENCE_MS = 250
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const NATURAL_PUNCTUATION_RE = /[.!?…。！？,，;；:：]$/u

/**
 * Refine sentence ranges into readable display ranges without inventing timing.
 *
 * Every emitted range is a non-empty, contiguous slice of the original source
 * fragments. A single over-limit fragment stays intact; the later word-level
 * task is the only safe place to split inside it.
 */
export function capSentenceRanges(
  fragments: Cue[],
  ranges: SentenceRange[],
): SentenceRange[] {
  const capped: SentenceRange[] = []

  for (const range of ranges) {
    let startIdx = range.startIdx

    while (startIdx <= range.endIdx) {
      const single = measureRange(fragments, startIdx, startIdx)
      if (startIdx === range.endIdx || single.units > single.target) {
        capped.push({ startIdx, endIdx: startIdx })
        startIdx += 1
        continue
      }

      let lastWithinTarget = startIdx
      let firstOverTarget: number | undefined

      for (let endIdx = startIdx; endIdx <= range.endIdx; endIdx++) {
        const measurement = measureRange(fragments, startIdx, endIdx)
        if (measurement.units <= measurement.target) {
          lastWithinTarget = endIdx
        } else {
          firstOverTarget = endIdx
          break
        }
      }

      if (firstOverTarget === undefined) {
        capped.push({ startIdx, endIdx: range.endIdx })
        break
      }

      let maxCandidate = lastWithinTarget
      for (
        let endIdx = firstOverTarget;
        endIdx <= range.endIdx;
        endIdx++
      ) {
        const measurement = measureRange(fragments, startIdx, endIdx)
        if (
          measurement.units >
          measurement.target * NATURAL_BOUNDARY_MAX_RATIO
        ) {
          break
        }
        maxCandidate = endIdx
      }

      const natural = findNaturalBoundary(
        fragments,
        startIdx,
        maxCandidate,
        range.endIdx,
      )
      const endIdx = natural ?? lastWithinTarget

      capped.push({ startIdx, endIdx })
      startIdx = endIdx + 1
    }
  }

  return capped
}

function findNaturalBoundary(
  fragments: Cue[],
  startIdx: number,
  maxEndIdx: number,
  sentenceEndIdx: number,
): number | undefined {
  let best: { endIdx: number; distance: number } | undefined

  for (let endIdx = startIdx; endIdx <= maxEndIdx; endIdx++) {
    const measurement = measureRange(fragments, startIdx, endIdx)
    if (measurement.units < measurement.target * NATURAL_BOUNDARY_MIN_RATIO) {
      continue
    }
    if (!isNaturalBoundary(fragments, endIdx, sentenceEndIdx)) continue

    const distance = Math.abs(measurement.units / measurement.target - 1)
    if (!best || distance < best.distance) best = { endIdx, distance }
  }

  return best?.endIdx
}

function isNaturalBoundary(
  fragments: Cue[],
  endIdx: number,
  sentenceEndIdx: number,
): boolean {
  if (endIdx === sentenceEndIdx) return true
  if (NATURAL_PUNCTUATION_RE.test(fragments[endIdx].o.trim())) return true
  const current = fragments[endIdx]
  const next = fragments[endIdx + 1]
  if (!next) return false
  return next.s - (current.s + current.d) >= PAUSE_PREFERENCE_MS
}

function measureRange(
  fragments: Cue[],
  startIdx: number,
  endIdx: number,
): { units: number; target: number } {
  const text = fragments
    .slice(startIdx, endIdx + 1)
    .map((fragment) => fragment.o)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (CJK_RE.test(text)) {
    return {
      units: Array.from(text).filter((char) => !/\s/u.test(char)).length,
      target: CJK_VISIBLE_CHAR_TARGET,
    }
  }

  return {
    units: text === '' ? 0 : text.split(/\s+/u).length,
    target: SPACE_WORD_TARGET,
  }
}

/**
 * Max time (ms) a sentence-cue may linger on screen past the end of its own
 * speech. Bridges tiny inter-sentence gaps (no flicker) while stopping a
 * subtitle from hanging through a long music/silence gap before the next line.
 */
export const GAP_TOLERANCE = 1200

export function rangeText(fragments: Cue[], range: SentenceRange): string {
  return fragments
    .slice(range.startIdx, range.endIdx + 1)
    .map((fragment) => fragment.o)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Build one timed cue using the shared next-range/gap-tolerance clamp. */
export function rangeToCue(
  fragments: Cue[],
  range: SentenceRange,
  nextRange?: SentenceRange,
  translation?: string,
): Cue {
  const first = fragments[range.startIdx]
  const last = fragments[range.endIdx]
  if (!first || !last) throw new SegmentationError('Cue range is outside the source fragments')
  const rawEnd = last.s + last.d
  const nextStart = nextRange ? fragments[nextRange.startIdx]?.s : undefined
  const end = nextStart === undefined ? rawEnd : Math.min(nextStart, rawEnd + GAP_TOLERANCE)
  const cue: Cue = {
    s: first.s,
    d: Math.max(1, end - first.s),
    o: rangeText(fragments, range),
  }
  if (translation !== undefined) {
    const target = translation.trim()
    if (!target) throw new SegmentationError('Empty translation for cue range')
    cue.t = translation
  }
  return cue
}

/**
 * Convert sentence ranges + their aligned translations into sentence-level
 * `Cue`s. Each cue joins its fragments' originals, carries the full sentence
 * translation, and spans the fragments' time range.
 *
 * Time clamp: a non-last sentence's end is capped at
 * `min(nextSentenceStart, rawEnd + GAP_TOLERANCE)` where `rawEnd = last.s + last.d`.
 * ASR fragment durations are estimated and frequently overlap (a later fragment
 * starts before the previous one's reported end), so:
 * - small gap / overlap → `nextStart` (gap-free, non-overlapping display);
 * - long gap (music/silence) → `rawEnd + GAP_TOLERANCE`, so the subtitle
 *   disappears ~1.2s after it is spoken instead of lingering the whole gap.
 * The last sentence uses its final fragment's raw end. Either way the cue ends
 * no later than the next sentence's start, so `findCueAt`'s binary search over
 * non-overlapping cues stays valid.
 *
 * Asserts exactly one translation per range and that every translation is
 * non-empty (write-on-full-success invariant); throws `SegmentationError`
 * otherwise.
 */
export function sentencesToCues(
  frags: Cue[],
  ranges: SentenceRange[],
  translations: string[],
): Cue[] {
  if (translations.length !== ranges.length) {
    throw new SegmentationError(
      `Sentence/translation count mismatch: ${ranges.length} sentences vs ${translations.length} translations`,
    )
  }

  return ranges.map((r, i) => {
    const t = (translations[i] ?? '').trim()
    if (t === '') {
      throw new SegmentationError(
        `Empty sentence translation for fragments [${r.startIdx + 1}-${r.endIdx + 1}]`,
      )
    }
    return rangeToCue(frags, r, ranges[i + 1], t)
  })
}
