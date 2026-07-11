import { describe, it, expect } from 'vitest'
import { stripNonSpeech, cleanCues } from './clean'
import type { Cue } from './timedtext'

describe('stripNonSpeech', () => {
  it('removes a standalone [Music] annotation', () => {
    expect(stripNonSpeech('[Music]')).toBe('')
  })

  it('removes a full-width 【音乐】 annotation', () => {
    expect(stripNonSpeech('【音乐】')).toBe('')
  })

  it('removes an inline bracketed annotation and collapses the gap', () => {
    expect(stripNonSpeech('and then [laughter] he said')).toBe('and then he said')
  })

  it('strips ♪ symbols but keeps the lyric text between them', () => {
    expect(stripNonSpeech('♪ la la ♪')).toBe('la la')
  })

  it('collapses runs of whitespace', () => {
    expect(stripNonSpeech('hello     world')).toBe('hello world')
  })

  it('leaves plain speech untouched', () => {
    expect(stripNonSpeech('Hello, world. How are you?')).toBe('Hello, world. How are you?')
  })

  it('does NOT strip parentheses (they carry real speech)', () => {
    expect(stripNonSpeech('I (really) mean it')).toBe('I (really) mean it')
  })
})

describe('cleanCues', () => {
  it('drops pure-annotation cues and cleans the rest, preserving timing', () => {
    const cues: Cue[] = [
      { s: 0, d: 1000, o: '[Music]' },
      { s: 1000, d: 1000, o: 'Hello [Applause] everyone' },
      { s: 2000, d: 1000, o: '【掌声】' },
      { s: 3000, d: 1500, o: 'Goodbye' },
    ]
    const out = cleanCues(cues)
    expect(out).toEqual([
      { s: 1000, d: 1000, o: 'Hello everyone' },
      { s: 3000, d: 1500, o: 'Goodbye' },
    ])
  })

  it('keeps lyric text from a ♪ cue and preserves its timing', () => {
    expect(cleanCues([{ s: 500, d: 1500, o: '♪ song lyric ♪' }])).toEqual([
      { s: 500, d: 1500, o: 'song lyric' },
    ])
  })

  it('returns an empty array when every cue is a pure annotation', () => {
    expect(cleanCues([{ s: 0, d: 1000, o: '[Music]' }, { s: 1000, d: 1000, o: '♪' }])).toEqual([])
  })
})
