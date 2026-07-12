import { describe, it, expect } from 'vitest'
import {
  parseBoundaries,
  groupByBoundaries,
  sentencesToCues,
  SegmentationError,
  type SentenceRange,
} from './segment'
import type { Cue } from '../subtitles/timedtext'

describe('parseBoundaries', () => {
  it('parses E/C flags into an end-flag array', () => {
    expect(parseBoundaries('[1] C\n[2] E\n[3] C\n[4] E', 4)).toEqual([
      false,
      true,
      false,
      true,
    ])
  })

  it('tolerates surrounding whitespace and text after the flag', () => {
    // Fragment 2 says C, but the last fragment is always forced to end.
    expect(parseBoundaries('  [1]  E \n[2] C (still going)', 2)).toEqual([true, true])
  })

  it('forces the last fragment to end even if the model said C', () => {
    expect(parseBoundaries('[1] C\n[2] C\n[3] C', 3)).toEqual([false, false, true])
  })

  it('ignores stray prose lines but still requires full coverage', () => {
    expect(parseBoundaries('here you go:\n[1] C\n[2] E', 2)).toEqual([false, true])
  })

  it('is order-independent: out-of-order lines fill by fragment number', () => {
    expect(parseBoundaries('[2] E\n[1] C\n[3] C', 3)).toEqual([false, true, true])
  })

  it('throws when a fragment is missing from the output', () => {
    expect(() => parseBoundaries('[1] E\n[3] E', 3)).toThrow(SegmentationError)
  })

  it('throws when the output has no parseable boundary lines', () => {
    expect(() => parseBoundaries('sorry, I cannot do that', 3)).toThrow(SegmentationError)
  })
})

describe('groupByBoundaries', () => {
  it('groups a single fragment into one sentence', () => {
    expect(groupByBoundaries([true])).toEqual([{ startIdx: 0, endIdx: 0 }])
  })

  it('splits into contiguous sentences at each end flag', () => {
    expect(groupByBoundaries([false, true, false, true])).toEqual([
      { startIdx: 0, endIdx: 1 },
      { startIdx: 2, endIdx: 3 },
    ])
  })

  it('treats an all-continue array as one sentence spanning every fragment', () => {
    expect(groupByBoundaries([false, false, false])).toEqual([{ startIdx: 0, endIdx: 2 }])
  })
})

describe('sentencesToCues', () => {
  // Fragment 2 starts at 900ms — before fragment 1's reported end (0+1000) — a
  // typical ASR overlap that the next-start time clamp must absorb.
  const frags: Cue[] = [
    { s: 0, d: 1000, o: 'Hello' },
    { s: 900, d: 1000, o: 'there' },
    { s: 2000, d: 1500, o: 'world' },
  ]

  it('clamps a non-last sentence end to the next sentence start; last uses raw end', () => {
    const ranges: SentenceRange[] = [
      { startIdx: 0, endIdx: 1 },
      { startIdx: 2, endIdx: 2 },
    ]
    const cues = sentencesToCues(frags, ranges, ['你好', '世界'])
    // Sentence 0: start 0, end clamped to frags[2].s (2000) → d = 2000
    // (NOT the raw 900 + 1000 = 1900), so display is gap-free.
    expect(cues[0]).toEqual({ s: 0, d: 2000, o: 'Hello there', t: '你好' })
    // Last sentence: raw end = 2000 + 1500 = 3500 → d = 1500.
    expect(cues[1]).toEqual({ s: 2000, d: 1500, o: 'world', t: '世界' })
  })

  it('joins and collapses whitespace across a sentence, single cue', () => {
    const f: Cue[] = [
      { s: 0, d: 1000, o: 'a  b' },
      { s: 1000, d: 1000, o: ' c ' },
    ]
    const cues = sentencesToCues(f, [{ startIdx: 0, endIdx: 1 }], ['x'])
    expect(cues).toHaveLength(1)
    expect(cues[0].o).toBe('a b c')
    // Sole (last) sentence uses the raw end: 1000 + 1000 = 2000.
    expect(cues[0].d).toBe(2000)
  })

  it('bridges a small inter-sentence gap to the next sentence start (within tolerance)', () => {
    // Sentence 0 speech ends at 1000; the next starts 500ms later (< 1200ms
    // tolerance), so the cue bridges to the next start → no flicker between
    // adjacent close sentences.
    const f: Cue[] = [
      { s: 0, d: 1000, o: 'A' },
      { s: 1500, d: 1000, o: 'B' },
    ]
    const ranges: SentenceRange[] = [
      { startIdx: 0, endIdx: 0 },
      { startIdx: 1, endIdx: 1 },
    ]
    const cues = sentencesToCues(f, ranges, ['a', 'b'])
    expect(cues[0].s).toBe(0)
    expect(cues[0].d).toBe(1500) // bridged to nextStart (1500), not rawEnd (1000)
    expect(cues[1].d).toBe(1000) // last sentence: raw end
    // Non-overlapping: end_0 <= start_1.
    expect(cues[0].s + cues[0].d).toBeLessThanOrEqual(cues[1].s)
  })

  it('caps a long gap at rawEnd + GAP_TOLERANCE so the subtitle stops lingering', () => {
    // Sentence 0 speech ends at 1000; the next starts at 5000 (a ~4s music/
    // silence gap). The cue must disappear ~1.2s after speech (at 2200), NOT
    // hang on until 5000.
    const f: Cue[] = [
      { s: 0, d: 1000, o: 'A' },
      { s: 5000, d: 1000, o: 'B' },
    ]
    const ranges: SentenceRange[] = [
      { startIdx: 0, endIdx: 0 },
      { startIdx: 1, endIdx: 1 },
    ]
    const cues = sentencesToCues(f, ranges, ['a', 'b'])
    expect(cues[0].s).toBe(0)
    expect(cues[0].d).toBe(2200) // rawEnd (1000) + GAP_TOLERANCE (1200)
    // Non-overlapping, with a genuine empty gap (2200..5000 shows nothing).
    expect(cues[0].s + cues[0].d).toBeLessThanOrEqual(cues[1].s)
  })

  it('clamps an overlapping next-start (next starts before this sentence ends)', () => {
    // Sentence 0 raw end is 2000; the next fragment starts at 1500 (ASR
    // overlap) → clamp to 1500 so cues never overlap.
    const f: Cue[] = [
      { s: 0, d: 2000, o: 'A' },
      { s: 1500, d: 1000, o: 'B' },
    ]
    const ranges: SentenceRange[] = [
      { startIdx: 0, endIdx: 0 },
      { startIdx: 1, endIdx: 1 },
    ]
    const cues = sentencesToCues(f, ranges, ['a', 'b'])
    expect(cues[0].d).toBe(1500) // clamped to nextStart (1500), not rawEnd (2000)
    expect(cues[0].s + cues[0].d).toBeLessThanOrEqual(cues[1].s)
  })

  it('throws when the translation count does not match the range count', () => {
    const ranges: SentenceRange[] = [
      { startIdx: 0, endIdx: 0 },
      { startIdx: 1, endIdx: 1 },
    ]
    expect(() => sentencesToCues(frags, ranges, ['only one'])).toThrow(SegmentationError)
  })

  it('throws on an empty sentence translation (write-on-full-success)', () => {
    expect(() =>
      sentencesToCues(frags, [{ startIdx: 0, endIdx: 2 }], ['   ']),
    ).toThrow(SegmentationError)
  })
})
