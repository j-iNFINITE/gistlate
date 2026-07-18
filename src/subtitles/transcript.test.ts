import { describe, expect, it } from 'vitest'
import type { Cue } from './timedtext'
import { findCueIndexAt } from './cues'
import {
  filterTranscriptCues,
  formatSrt,
  formatSrtTimestamp,
  IncompleteTranslatedSrtError,
  InvalidSrtTimelineError,
} from './transcript'

const CUES: Cue[] = [
  { s: 0, d: 1234, o: 'Gundam Marker', t: '高达马克笔' },
  { s: 1234, d: 2500, o: 'Clear parts', t: '透明零件' },
  { s: 3734, d: 1000, o: 'Final line' },
]

describe('transcript projections', () => {
  it('searches both channels without changing canonical order or indices', () => {
    expect(filterTranscriptCues(CUES, 'CLEAR')).toEqual([{ index: 1, cue: CUES[1] }])
    expect(filterTranscriptCues(CUES, '高达')).toEqual([{ index: 0, cue: CUES[0] }])
    expect(filterTranscriptCues(CUES, '  ＣＬＥＡＲ   parts ')).toEqual([
      { index: 1, cue: CUES[1] },
    ])
    expect(filterTranscriptCues(CUES, '')).toEqual(CUES.map((cue, index) => ({ cue, index })))
  })

  it('finds the exact active cue index and returns -1 inside timeline gaps', () => {
    expect(findCueIndexAt(CUES, 1234)).toBe(1)
    expect(findCueIndexAt([
      { s: 0, d: 1000, o: 'before' },
      { s: 2000, d: 1000, o: 'after' },
    ], 1500)).toBe(-1)
    expect(findCueIndexAt(CUES, 99_999)).toBe(-1)
  })
})

describe('SRT formatting', () => {
  it('formats exact ordered source timestamps and normalizes line endings', () => {
    const srt = formatSrt([
      { s: 0, d: 1234, o: 'First\r\nline', t: '第一行' },
      { s: 3_661_005, d: 995, o: 'Second', t: '第二行' },
    ], 'original')
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,234\nFirst\nline\n\n' +
      '2\n01:01:01,005 --> 01:01:02,000\nSecond\n',
    )
    expect(formatSrtTimestamp(3_661_005)).toBe('01:01:01,005')
  })

  it('exports only real translated text and reports every missing cue', () => {
    expect(formatSrt(CUES.slice(0, 2), 'translated')).toContain(
      '00:00:00,000 --> 00:00:01,234\n高达马克笔',
    )
    expect(() => formatSrt(CUES, 'translated')).toThrow(IncompleteTranslatedSrtError)
    try {
      formatSrt(CUES, 'translated')
    } catch (error) {
      expect(error).toMatchObject({ cueNumbers: [3] })
    }
  })

  it('rejects invalid or overlapping artifact timelines', () => {
    expect(() => formatSrt([{ s: -1, d: 1000, o: 'negative' }], 'original'))
      .toThrow(InvalidSrtTimelineError)
    expect(() => formatSrt([{ s: 0, d: 0, o: 'zero duration' }], 'original'))
      .toThrow(InvalidSrtTimelineError)
    expect(() => formatSrt([
      { s: 0, d: 2000, o: 'one' },
      { s: 1500, d: 1000, o: 'two' },
    ], 'original')).toThrow(InvalidSrtTimelineError)
  })
})
