import type { Cue } from '../subtitles/timedtext'

/**
 * One reconstructed sentence: a contiguous, inclusive run of fragments
 * (0-based indices into the fragment array) plus its full translation.
 * Internal only — never stored; sentences are converted to `Cue`s.
 */
export interface Sentence {
  /** 0-based index of the first fragment (inclusive). */
  startIdx: number
  /** 0-based index of the last fragment (inclusive). */
  endIdx: number
  /** Full sentence translation. */
  t: string
}

/**
 * Thrown when segmentation output does not fully and cleanly cover fragments
 * 1..N. The pipeline retries a few times, then falls back to 1:1 translation.
 */
export class SegmentationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SegmentationError'
  }
}

/**
 * Parse `[<start>-<end>] <translation>` (or `[<n>] <translation>`) lines into
 * sentences and validate full coverage of fragments 1..N.
 *
 * Lines that do not match the expected shape (blank lines, stray prose) are
 * ignored. The surviving ranges must, after sorting by start index:
 * - start at fragment 1 (`startIdx === 0`),
 * - be contiguous and non-overlapping (`next.startIdx === prev.endIdx + 1`),
 * - end at fragment N (`endIdx === n - 1`),
 * - have `startIdx <= endIdx` and a non-empty translation.
 *
 * Any violation throws `SegmentationError`.
 */
export function parseSentences(output: string, n: number): Sentence[] {
  const sentences: Sentence[] = []

  for (const line of output.split('\n')) {
    const m = line.match(/^\s*\[(\d+)(?:\s*-\s*(\d+))?\]\s*(.+)$/)
    if (!m) continue
    const start = Number.parseInt(m[1], 10)
    const end = m[2] !== undefined ? Number.parseInt(m[2], 10) : start
    sentences.push({ startIdx: start - 1, endIdx: end - 1, t: m[3].trim() })
  }

  if (sentences.length === 0) {
    throw new SegmentationError('Segmentation produced no parseable sentence lines')
  }

  sentences.sort((a, b) => a.startIdx - b.startIdx)

  if (sentences[0].startIdx !== 0) {
    throw new SegmentationError(
      `Segmentation must start at fragment 1 (got ${sentences[0].startIdx + 1})`,
    )
  }

  const last = sentences[sentences.length - 1]
  if (last.endIdx !== n - 1) {
    throw new SegmentationError(
      `Segmentation must end at fragment ${n} (got ${last.endIdx + 1})`,
    )
  }

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    if (s.startIdx > s.endIdx) {
      throw new SegmentationError(
        `Segmentation range is inverted: [${s.startIdx + 1}-${s.endIdx + 1}]`,
      )
    }
    if (s.t === '') {
      throw new SegmentationError(
        `Segmentation has an empty translation for [${s.startIdx + 1}-${s.endIdx + 1}]`,
      )
    }
    if (i > 0 && s.startIdx !== sentences[i - 1].endIdx + 1) {
      throw new SegmentationError(
        `Segmentation not contiguous near fragment ${s.startIdx + 1} ` +
          `(previous ended at ${sentences[i - 1].endIdx + 1})`,
      )
    }
  }

  return sentences
}

/**
 * Convert validated sentences into sentence-level `Cue`s: each sentence becomes
 * one cue that spans its fragments' time range, joins their originals, and
 * carries the full translation. Asserts every translation is non-empty
 * (write-on-full-success invariant); throws otherwise.
 */
export function sentencesToCues(frags: Cue[], sentences: Sentence[]): Cue[] {
  return sentences.map((s) => {
    const first = frags[s.startIdx]
    const last = frags[s.endIdx]
    const o = frags
      .slice(s.startIdx, s.endIdx + 1)
      .map((f) => f.o)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const t = s.t.trim()
    if (t === '') {
      throw new SegmentationError(
        `Empty sentence translation for [${s.startIdx + 1}-${s.endIdx + 1}]`,
      )
    }
    return {
      s: first.s,
      d: last.s + last.d - first.s,
      o,
      t,
    }
  })
}
