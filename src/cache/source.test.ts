import { describe, expect, it } from 'vitest'
import {
  normalizedSourceText,
  sourceFingerprint,
  sourceIsCompatible,
  sourceTimelineIsCompatible,
} from './source'

describe('subtitle source identity', () => {
  it('is stable across canonical display regrouping and whitespace differences', async () => {
    const fragments = [
      { s: 0, d: 100, o: '模型' },
      { s: 100, d: 100, o: ' です。 ' },
    ]
    const regrouped = [{ s: 0, d: 200, o: '模型 です。' }]
    expect(normalizedSourceText(fragments)).toBe('模型 です。')
    expect(await sourceFingerprint(fragments)).toBe(await sourceFingerprint(regrouped))
    expect(await sourceIsCompatible(fragments, regrouped)).toBe(true)
  })

  it('rejects a different manual/ASR source even when the video and language match', async () => {
    const manual = [{ s: 0, d: 100, o: 'correct caption' }]
    const asr = [{ s: 0, d: 100, o: 'incorrect caption' }]
    expect(await sourceIsCompatible(manual, asr)).toBe(false)
    expect(await sourceIsCompatible(manual, manual, await sourceFingerprint(asr))).toBe(false)
  })

  it('accepts regrouped cues only when their derived timeline matches the current source', () => {
    const fragments = [
      { s: 1000, d: 500, o: 'one' },
      { s: 1500, d: 500, o: 'two' },
      { s: 2000, d: 700, o: 'three' },
    ]
    expect(sourceTimelineIsCompatible(fragments, [
      { s: 1000, d: 1000, o: 'one two', t: '一二' },
      { s: 2000, d: 700, o: 'three', t: '三' },
    ])).toBe(true)
    expect(sourceTimelineIsCompatible(fragments, [
      { s: 4000, d: 1000, o: 'one two', t: '一二' },
      { s: 5000, d: 700, o: 'three', t: '三' },
    ])).toBe(false)
  })

  it('rejects an old long-gap cue that lingers beyond the current gap tolerance', async () => {
    const source = [
      { s: 0, d: 1000, o: 'first' },
      { s: 10_000, d: 1000, o: 'second' },
    ]
    const stale = [
      { s: 0, d: 10_000, o: 'first', t: '第一' },
      { s: 10_000, d: 1000, o: 'second', t: '第二' },
    ]
    expect(await sourceIsCompatible(source, stale)).toBe(false)
  })
})
