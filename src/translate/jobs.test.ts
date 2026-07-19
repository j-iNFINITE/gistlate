import { describe, expect, it } from 'vitest'
import { parseTimedtext, type Cue } from '../subtitles/timedtext'
import {
  assembleJobs,
  buildSentencePlans,
  completeAlignedJob,
  completeFallbackJob,
  createSentenceJobs,
  groupPlans,
  selectNextTimedGroupIndex,
} from './jobs'
import { groupByBoundaries } from './segment'

function fragments(count: number): Cue[] {
  return Array.from({ length: count }, (_, index) => ({
    s: index * 1000,
    d: 1000,
    o: `w${index + 1}`,
  }))
}

describe('complete sentence plans', () => {
  it('keeps one complete translation owner with nested readable display ranges', () => {
    const cues = fragments(20)
    const plans = buildSentencePlans(cues, [{ startIdx: 0, endIdx: 19 }])
    expect(plans).toHaveLength(1)
    expect(plans[0].id).toBe('S001')
    expect(plans[0].sourceRange).toEqual({ startIdx: 0, endIdx: 19 })
    expect(plans[0].displayRanges).toEqual([
      { startIdx: 0, endIdx: 14 },
      { startIdx: 15, endIdx: 19 },
    ])
  })

  it('rejects incomplete or gapped complete-range coverage', () => {
    expect(() => buildSentencePlans(fragments(3), [{ startIdx: 1, endIdx: 2 }])).toThrow(/coverage/i)
    expect(() => buildSentencePlans(fragments(3), [{ startIdx: 0, endIdx: 1 }])).toThrow(/cover/i)
  })

  it('rejects a boundary result that calls a multi-sentence minute-long paragraph one sentence', () => {
    const source = Array.from({ length: 35 }, (_, index): Cue => ({
      s: index * 2000,
      d: 2000,
      o: index % 3 === 2 ? `段落${index}。` : `段落${index}`,
    }))
    expect(() => buildSentencePlans(source, [{ startIdx: 0, endIdx: source.length - 1 }]))
      .toThrow(/sentence.*limit|too long/i)
  })

  it('accepts valid long English sentences observed in 5zKyUcKU134', () => {
    const samples = [
      {
        chars: 243,
        duration: 9760,
        text: 'Then I have my mid-tier pick, which is this nipper right here sent by Ulie, ' +
          "which I'd recommend for someone that is confident, they like model kits, but maybe " +
          'only builds one or two kits a year and maybe likes to take their time when building.',
      },
      {
        chars: 321,
        duration: 14_000,
        text: 'These just make your decal life much easier with Mark Setter acting as a wet ' +
          'adhesive when dried and Mark softer being a solution to make the decals adhere to the ' +
          'shape of the plastic much easier, which is really useful if you ever have a decal that ' +
          'needs to go around a corner but refuses to stick on around that corner.',
      },
    ]

    for (const { chars, duration, text } of samples) {
      expect(Array.from(text)).toHaveLength(chars)
      const words = text.split(' ')
      const source = words.map((word, index): Cue => {
        const start = Math.round(index * duration / words.length)
        const end = Math.round((index + 1) * duration / words.length)
        return { s: start, d: end - start, o: word }
      })

      const plans = buildSentencePlans(source, [{ startIdx: 0, endIdx: source.length - 1 }])
      expect(plans).toHaveLength(1)
      expect(plans[0].sourceText).toBe(text)
      expect(plans[0].displayRanges.length).toBeGreaterThan(1)
    }
  })

  it('accepts a short punctuated ASR sentence before a long silence', () => {
    const source = parseTimedtext({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 2500,
          segs: [
            { utf8: 'A ', tOffsetMs: 0 },
            { utf8: '32-character ', tOffsetMs: 500 },
            { utf8: 'sentence ends.', tOffsetMs: 1000 },
          ],
        },
        {
          tStartMs: 38_320,
          dDurationMs: 2000,
          segs: [
            { utf8: 'Speech ', tOffsetMs: 0 },
            { utf8: 'resumes.', tOffsetMs: 700 },
          ],
        },
      ],
    }, { kind: 'asr' })
    const flags = source.map((cue) => cue.sentenceEnd === true)

    expect(() => buildSentencePlans(source, groupByBoundaries(flags))).not.toThrow()
  })
})

describe('grouping and assembly', () => {
  const plans = buildSentencePlans(fragments(5), [
    { startIdx: 0, endIdx: 0 },
    { startIdx: 1, endIdx: 1 },
    { startIdx: 2, endIdx: 2 },
    { startIdx: 3, endIdx: 3 },
    { startIdx: 4, endIdx: 4 },
  ])

  it('groups the same sentence plans in sentence, batch and whole modes', () => {
    expect(groupPlans(plans, 'sentence', 8).map((group) => group.plans.length)).toEqual([1, 1, 1, 1, 1])
    expect(groupPlans(plans, 'batch', 2).map((group) => group.plans.length)).toEqual([2, 2, 1])
    expect(groupPlans(plans, 'whole', 8).map((group) => group.plans.length)).toEqual([5])
  })

  it('prioritizes the group covering the current playhead', () => {
    const groups = groupPlans(plans, 'sentence', 8)
    expect(selectNextTimedGroupIndex(groups, fragments(5), 3200)).toBe(3)
  })

  it('preserves exact target reconstruction and pending original-only cues', () => {
    const source = fragments(20)
    const longPlan = buildSentencePlans(source, [{ startIdx: 0, endIdx: 19 }])
    const jobs = createSentenceJobs(longPlan)
    expect(assembleJobs(source, jobs).every((cue) => cue.t === undefined)).toBe(true)
    completeAlignedJob(jobs[0], '甲乙，丙丁', [3])
    const translated = assembleJobs(source, jobs)
    expect(translated.map((cue) => cue.t).join('')).toBe('甲乙，丙丁')
  })

  it('uses one full-source/full-target long cue for the safe fallback', () => {
    const source = fragments(20)
    const jobs = createSentenceJobs(buildSentencePlans(source, [{ startIdx: 0, endIdx: 19 }]))
    completeFallbackJob(jobs[0], '完整译文')
    expect(assembleJobs(source, jobs)).toEqual([
      { s: 0, d: 20000, o: source.map((cue) => cue.o).join(' '), t: '完整译文' },
    ])
  })
})
