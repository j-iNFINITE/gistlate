import type { TranslationMode } from '../settings'
import type { Cue } from '../subtitles/timedtext'
import { countSentenceMarks } from '../subtitles/sentence-marks'
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

export interface TranslationJobFailureDetail {
  id: string
  sourceText: string
  startMs?: number
  endMs?: number
  causeName: string
  causeMessage: string
}

/** Complete-only pipeline failure that preserves each failed job's local cause. */
export class TranslationJobsIncompleteError extends Error {
  readonly failures: TranslationJobFailureDetail[]

  constructor(failures: TranslationJobFailureDetail[]) {
    const summary = failures.map((failure) => {
      const timing = failure.startMs === undefined || failure.endMs === undefined
        ? 'time-unknown'
        : `${failure.startMs}-${failure.endMs}ms`
      return `${failure.id} ${timing} ${failure.causeName}: ${failure.causeMessage} ` +
        `source=${JSON.stringify(failure.sourceText)}`
    }).join('; ')
    super(`Translation incomplete: ${summary}`)
    this.name = 'TranslationJobsIncompleteError'
    this.failures = failures
  }
}

export interface PlanGroup {
  id: string
  plans: SentencePlan[]
}

const MAX_SENTENCE_DURATION_MS = 30_000
const MAX_SENTENCE_CODE_POINTS = 240
const MAX_INTERNAL_SENTENCE_MARKS = 3

export function buildSentencePlans(
  fragments: Cue[],
  completeRanges: SentenceRange[],
  options: { trustedCueBoundaries?: boolean } = {},
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
    const sourceText = rangeText(fragments, sourceRange)
    if (!options.trustedCueBoundaries) {
      validateSentenceLimits(fragments, sourceRange, sourceText, index)
    }
    const displayRanges = capSentenceRanges(fragments, [sourceRange])
    validateDisplayCoverage(sourceRange, displayRanges)
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

function validateSentenceLimits(
  fragments: Cue[],
  range: SentenceRange,
  sourceText: string,
  index: number,
): void {
  const first = fragments[range.startIdx]
  const last = fragments[range.endIdx]
  const duration = last.s + last.d - first.s
  const codePoints = Array.from(sourceText).length
  const sentenceMarks = countSentenceMarks(sourceText)
  if (
    duration > MAX_SENTENCE_DURATION_MS ||
    codePoints > MAX_SENTENCE_CODE_POINTS ||
    sentenceMarks > MAX_INTERNAL_SENTENCE_MARKS
  ) {
    throw new SegmentationError(
      `Sentence ${index + 1} exceeds safety limit (${duration}ms, ${codePoints} chars, ${sentenceMarks} stops)`,
    )
  }
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

export function assertAllJobsComplete(jobs: SentenceJob[], fragments: Cue[] = []): void {
  const failed = jobs.filter((job) => job.status !== 'done')
  if (failed.length > 0) {
    throw new TranslationJobsIncompleteError(failed.map((job) => {
      const first = fragments[job.plan.sourceRange.startIdx]
      const last = fragments[job.plan.sourceRange.endIdx]
      return {
        id: job.plan.id,
        sourceText: summarizeFailureText(job.plan.sourceText, 160),
        startMs: first?.s,
        endMs: last ? last.s + last.d : undefined,
        causeName: summarizeFailureText(job.error?.name || 'Error', 80),
        causeMessage: summarizeFailureText(
          job.error?.message || 'Unknown translation job failure',
          240,
        ),
      }
    }))
  }
  const cues = jobs.flatMap((job) => job.targetSlices ?? [])
  if (cues.some((target) => !target)) throw new Error('Translation contains an empty target slice')
}

function summarizeFailureText(value: string, maxCodePoints: number): string {
  const normalized = value.replace(/[\s\p{Cc}]+/gu, ' ').trim()
  const codePoints = Array.from(normalized)
  return codePoints.length <= maxCodePoints
    ? normalized
    : `${codePoints.slice(0, maxCodePoints).join('')}…`
}
