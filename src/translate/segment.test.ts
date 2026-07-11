import { describe, it, expect } from 'vitest'
import { parseSentences, sentencesToCues, SegmentationError, type Sentence } from './segment'
import type { Cue } from '../subtitles/timedtext'

describe('parseSentences', () => {
  it('parses multi- and single-fragment sentences that cover 1..N', () => {
    const out = '[1-2] first sentence\n[3] second\n[4-5] third sentence'
    expect(parseSentences(out, 5)).toEqual([
      { startIdx: 0, endIdx: 1, t: 'first sentence' },
      { startIdx: 2, endIdx: 2, t: 'second' },
      { startIdx: 3, endIdx: 4, t: 'third sentence' },
    ])
  })

  it('parses a lone single-fragment sentence', () => {
    expect(parseSentences('[1] only', 1)).toEqual([{ startIdx: 0, endIdx: 0, t: 'only' }])
  })

  it('tolerates a valid partition given out of order (sorts by start)', () => {
    expect(parseSentences('[3] c\n[1-2] ab', 3)).toEqual([
      { startIdx: 0, endIdx: 1, t: 'ab' },
      { startIdx: 2, endIdx: 2, t: 'c' },
    ])
  })

  it('ignores stray prose lines but still validates coverage', () => {
    const out = 'Here are the sentences:\n[1-2] hi\n[3] bye'
    expect(parseSentences(out, 3)).toEqual([
      { startIdx: 0, endIdx: 1, t: 'hi' },
      { startIdx: 2, endIdx: 2, t: 'bye' },
    ])
  })

  it('rejects a gap between ranges', () => {
    expect(() => parseSentences('[1] a\n[3] c', 3)).toThrow(SegmentationError)
  })

  it('rejects overlapping ranges', () => {
    expect(() => parseSentences('[1-2] a\n[2-3] b', 3)).toThrow(SegmentationError)
  })

  it('rejects output that does not start at fragment 1', () => {
    expect(() => parseSentences('[2-3] a', 3)).toThrow(SegmentationError)
  })

  it('rejects output that ends before fragment N', () => {
    expect(() => parseSentences('[1-2] a', 3)).toThrow(SegmentationError)
  })

  it('rejects a reversed / out-of-order range', () => {
    expect(() => parseSentences('[1] a\n[3-2] b\n[4] c', 4)).toThrow(SegmentationError)
  })

  it('rejects an empty translation', () => {
    // "[1]   " matches the shape but trims to an empty translation.
    expect(() => parseSentences('[1]   \n[2] hello', 2)).toThrow(SegmentationError)
  })

  it('rejects output with no parseable sentence lines', () => {
    expect(() => parseSentences('sorry, I cannot do that', 3)).toThrow(SegmentationError)
  })
})

describe('sentencesToCues', () => {
  it('builds sentence-cues with joined originals and correct time spans', () => {
    const frags: Cue[] = [
      { s: 0, d: 1000, o: 'Hello' },
      { s: 1000, d: 1000, o: 'there' },
      { s: 2000, d: 1500, o: 'world' },
    ]
    const sentences: Sentence[] = [
      { startIdx: 0, endIdx: 1, t: '你好' },
      { startIdx: 2, endIdx: 2, t: '世界' },
    ]
    expect(sentencesToCues(frags, sentences)).toEqual([
      { s: 0, d: 2000, o: 'Hello there', t: '你好' },
      { s: 2000, d: 1500, o: 'world', t: '世界' },
    ])
  })

  it('collapses whitespace when joining fragment originals', () => {
    const frags: Cue[] = [
      { s: 0, d: 1000, o: 'a  b' },
      { s: 1000, d: 1000, o: ' c ' },
    ]
    const [cue] = sentencesToCues(frags, [{ startIdx: 0, endIdx: 1, t: 'x' }])
    expect(cue.o).toBe('a b c')
  })
})
