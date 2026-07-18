import type { TranslationMode } from '../settings'
import type { Cue } from '../subtitles/timedtext'
import {
  capSentenceRanges,
  rangeText,
  rangeToCue,
  SegmentationError,
  type SentenceRange,
} from './segment'
import { sliceByCodePoints, type SentenceReference } from './prompt'

export interface SentencePlan extends SentenceReference {
  sourceRange: SentenceRange
  displayRanges: SentenceRange[]
  displayTexts: string[]
}

export type SentenceJobStatus = 'pending' | 'translating' | 'aligning' | 'done' | 'failed'

export interface SentenceJob {
  plan: SentencePlan
  status: SentenceJobStatus
  canonicalTarget?: string
  targetSlices?: string[]
  alignmentFallback?: boolean
  error?: Error
}

export interface PlanGroup {
  id: string
  plans: SentencePlan[]
}

export function buildSentencePlans(
  fragments: Cue[],
  completeRanges: SentenceRange[],
): SentencePlan[] {
  if (fragments.length === 0 && completeRanges.length === 0) return []
  let expectedStart = 0
  const width = Math.max(3, String(completeRanges.length).length)
  const plans = completeRanges.map((sourceRange, index): SentencePlan => {
    if (sourceRange.startIdx !== expectedStart || sourceRange.endIdx < sourceRange.startIdx ||
        sourceRange.endIdx >= fragments.length) {
      throw new SegmentationError(`Invalid complete sentence coverage at sentence ${index + 1}`)
    }
    expectedStart = sourceRange.endIdx + 1
    const displayRanges = capSentenceRanges(fragments, [sourceRange])
    validateDisplayCoverage(sourceRange, displayRanges)
    const sourceText = rangeText(fragments, sourceRange)
    const displayTexts = displayRanges.map((range) => rangeText(fragments, range))
    if (!sourceText || displayTexts.some((text) => !text)) {
      throw new SegmentationError(`Empty source text at sentence ${index + 1}`)
    }
    return {
      id: `S${String(index + 1).padStart(width, '0')}`,
      sourceRange,
      sourceText,
      displayRanges,
      displayTexts,
    }
  })
  if (expectedStart !== fragments.length) {
    throw new SegmentationError(`Complete sentences cover ${expectedStart}/${fragments.length} fragments`)
  }
  return plans
}

function validateDisplayCoverage(source: SentenceRange, ranges: SentenceRange[]): void {
  let expected = source.startIdx
  for (const range of ranges) {
    if (range.startIdx !== expected || range.endIdx < range.startIdx || range.endIdx > source.endIdx) {
      throw new SegmentationError('Display ranges do not exactly cover their complete sentence')
    }
    expected = range.endIdx + 1
  }
  if (expected !== source.endIdx + 1) {
    throw new SegmentationError('Display ranges leave a gap in their complete sentence')
  }
}

export function createSentenceJobs(plans: SentencePlan[]): SentenceJob[] {
  return plans.map((plan) => ({ plan, status: 'pending' }))
}

export function groupPlans(
  plans: SentencePlan[],
  mode: TranslationMode,
  batchSize: number,
): PlanGroup[] {
  if (plans.length === 0) return []
  const size = mode === 'sentence'
    ? 1
    : mode === 'whole'
      ? plans.length
      : Math.min(32, Math.max(2, Math.trunc(batchSize) || 8))
  const groups: PlanGroup[] = []
  for (let index = 0; index < plans.length; index += size) {
    const slice = plans.slice(index, index + size)
    groups.push({ id: `${slice[0].id}-${slice[slice.length - 1].id}`, plans: slice })
  }
  return groups
}

export function selectNextTimedGroupIndex(
  groups: PlanGroup[],
  fragments: Cue[],
  playheadMs: number,
): number {
  let selected = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < groups.length; index++) {
    const plans = groups[index].plans
    const first = fragments[plans[0].sourceRange.startIdx]
    const last = fragments[plans[plans.length - 1].sourceRange.endIdx]
    const start = first.s
    const end = last.s + last.d
    const score = playheadMs >= start && playheadMs < end
      ? 0
      : start >= playheadMs
        ? 1 + start - playheadMs
        : 1_000_000_000 + playheadMs - end
    if (score < bestScore) {
      bestScore = score
      selected = index
    }
  }
  return selected
}

export function completeAlignedJob(
  job: SentenceJob,
  canonicalTarget: string,
  cuts: number[] = [],
): void {
  const targetSlices = sliceByCodePoints(canonicalTarget, cuts)
  if (targetSlices.length !== job.plan.displayRanges.length ||
      targetSlices.some((slice) => slice.length === 0) ||
      targetSlices.join('') !== canonicalTarget) {
    throw new SegmentationError(`Target slices do not reconstruct ${job.plan.id}`)
  }
  job.canonicalTarget = canonicalTarget
  job.targetSlices = targetSlices
  job.alignmentFallback = false
  job.status = 'done'
}

export function completeFallbackJob(job: SentenceJob, canonicalTarget: string): void {
  if (!canonicalTarget.trim()) throw new SegmentationError(`Empty target for ${job.plan.id}`)
  job.canonicalTarget = canonicalTarget
  job.targetSlices = [canonicalTarget]
  job.alignmentFallback = true
  job.status = 'done'
}

/** Assemble translated and pending jobs into one sorted, binary-search-safe cue list. */
export function assembleJobs(fragments: Cue[], jobs: SentenceJob[]): Cue[] {
  const units: Array<{ range: SentenceRange; target?: string }> = []
  for (const job of jobs) {
    if (job.status === 'done' && job.alignmentFallback) {
      units.push({ range: job.plan.sourceRange, target: job.canonicalTarget })
      continue
    }
    for (let index = 0; index < job.plan.displayRanges.length; index++) {
      units.push({
        range: job.plan.displayRanges[index],
        target: job.status === 'done' ? job.targetSlices?.[index] : undefined,
      })
    }
  }
  return units.map((unit, index) =>
    rangeToCue(fragments, unit.range, units[index + 1]?.range, unit.target),
  )
}

export function assertAllJobsComplete(jobs: SentenceJob[]): void {
  const failed = jobs.filter((job) => job.status !== 'done')
  if (failed.length > 0) {
    throw new Error(`Translation incomplete for: ${failed.map((job) => job.plan.id).join(', ')}`)
  }
  const cues = jobs.flatMap((job) => job.targetSlices ?? [])
  if (cues.some((target) => !target)) throw new Error('Translation contains an empty target slice')
}
