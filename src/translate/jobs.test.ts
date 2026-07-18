import { describe, expect, it } from 'vitest'
import type { Cue } from '../subtitles/timedtext'
import {
  assembleJobs,
  buildSentencePlans,
  completeAlignedJob,
  completeFallbackJob,
  createSentenceJobs,
  groupPlans,
  selectNextTimedGroupIndex,
} from './jobs'

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
