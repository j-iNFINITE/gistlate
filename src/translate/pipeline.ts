import type { Cue } from '../subtitles/timedtext'
import type { OpenAIConfig, TranslationSettings } from '../settings'
import type { TranslationContext } from './context'
import {
  boundaryBatch,
  completePrompt,
  CountMismatchError,
  isSplittable,
  TruncationError,
} from './openai'
import { groupByBoundaries, parseBoundaries } from './segment'
import {
  assembleJobs,
  assertAllJobsComplete,
  buildSentencePlans,
  completeAlignedJob,
  completeFallbackJob,
  createSentenceJobs,
  groupPlans,
  selectNextTimedGroupIndex,
  type PlanGroup,
  type SentenceJob,
  type SentencePlan,
} from './jobs'
import {
  fillAlignmentPrompt,
  fillCanonicalPrompt,
  hasEnoughSafeAlignmentCuts,
  parseAlignmentCuts,
  parseGlobalTranslations,
  type SentenceReference,
} from './prompt'
import type { RequestUsage, UsageStage } from '../usage/contracts'
import { validateCanonicalTarget } from './validation'

const BOUNDARY_RETRIES = 2
const TRANSLATION_RETRIES = 3
const ALIGNMENT_ATTEMPTS = 3
export const TRANSLATION_CONCURRENCY = 8

export interface TranslationProgress {
  stage: 'boundaries' | 'translating' | 'aligning'
  completedSentences: number
  totalSentences: number
  cues: Cue[]
}

export interface PipelineDiagnostics {
  boundaryMethod: 'timed-punctuation' | 'llm'
  boundaryRequestCount: number
  translationRequestCount: number
  alignmentRequestCount: number
  fallbackSentenceCount: number
}

export interface TranslationPipelineResult {
  cues: Cue[]
  diagnostics: PipelineDiagnostics
}

export interface TranslationPipelineOptions {
  signal?: AbortSignal
  context?: TranslationContext
  translation: TranslationSettings
  getCurrentTime?: () => number
  onProgress?: (progress: TranslationProgress) => void
  onUsage?: (stage: UsageStage, usage?: RequestUsage) => Promise<void> | void
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation pipeline aborted')
}

/**
 * Complete-sentence translation pipeline. Display capping never creates a
 * translation owner: one immutable canonical target is generated per plan,
 * then a separate cut-only alignment maps it onto source-timed display ranges.
 */
export async function translateCues(
  cues: Cue[],
  targetLang: string,
  openaiCfg: OpenAIConfig,
  apiKey: string,
  options: TranslationPipelineOptions,
): Promise<TranslationPipelineResult> {
  const diagnostics: PipelineDiagnostics = {
    boundaryMethod: 'llm',
    boundaryRequestCount: 0,
    translationRequestCount: 0,
    alignmentRequestCount: 0,
    fallbackSentenceCount: 0,
  }
  if (cues.length === 0) return { cues: [], diagnostics }

  const { signal, context, translation, getCurrentTime, onProgress, onUsage } = options
  throwIfAborted(signal)
  onProgress?.({ stage: 'boundaries', completedSentences: 0, totalSentences: 0, cues })

  const endFlags = await detectBoundaries(
    cues,
    openaiCfg,
    apiKey,
    signal,
    diagnostics,
    (usage) => onUsage?.('boundary', usage),
  )
  const plans = buildSentencePlans(cues, groupByBoundaries(endFlags))
  const jobs = createSentenceJobs(plans)
  const references: SentenceReference[] = plans.map(({ id, sourceText }) => ({ id, sourceText }))
  const groups = groupPlans(plans, translation.mode, translation.batchSize)
  let completedSentences = 0

  const emit = (stage: TranslationProgress['stage']): void => {
    onProgress?.({
      stage,
      completedSentences,
      totalSentences: jobs.length,
      cues: assembleJobs(cues, jobs),
    })
  }
  emit('translating')

  const runGroup = async (group: PlanGroup): Promise<void> => {
    const groupJobs = group.plans.map((plan) => jobs[plans.indexOf(plan)])
    groupJobs.forEach((job) => { job.status = 'translating' })
    try {
      const translations = await translateGroupAdaptive(
        group.plans,
        references,
        targetLang,
        openaiCfg,
        apiKey,
        signal,
        context,
        diagnostics,
        (usage) => onUsage?.('translation', usage),
      )
      for (const job of groupJobs) {
        job.canonicalTarget = translations.get(job.plan.id)
        job.status = job.plan.displayRanges.length > 1 ? 'aligning' : 'translating'
      }
      if (groupJobs.some((job) => job.status === 'aligning')) emit('aligning')

      await Promise.all(groupJobs.map(async (job) => {
        const target = job.canonicalTarget
        if (!target) throw new Error(`Missing canonical target for ${job.plan.id}`)
        if (job.plan.displayRanges.length === 1) {
          completeAlignedJob(job, target)
          return
        }
        await alignJob(
          job,
          references,
          target,
          openaiCfg,
          apiKey,
          signal,
          context,
          diagnostics,
          (usage) => onUsage?.('alignment', usage),
        )
      }))
      completedSentences += groupJobs.length
    } catch (error) {
      groupJobs.forEach((job) => {
        if (job.status !== 'done') {
          job.status = 'failed'
          job.error = error as Error
        }
      })
    }
    emit('translating')
  }

  const pending = [...groups]
  if (pending.length > 0) {
    // One sequential playhead-near request warms DeepSeek's stable transcript prefix.
    const warmIndex = selectNextTimedGroupIndex(pending, cues, getCurrentTime?.() ?? 0)
    const [warm] = pending.splice(warmIndex, 1)
    await runGroup(warm)
  }

  const worker = async (): Promise<void> => {
    while (pending.length > 0) {
      throwIfAborted(signal)
      const nextIndex = selectNextTimedGroupIndex(pending, cues, getCurrentTime?.() ?? 0)
      const [group] = pending.splice(nextIndex, 1)
      await runGroup(group)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(TRANSLATION_CONCURRENCY, pending.length) }, () => worker()),
  )
  throwIfAborted(signal)
  assertAllJobsComplete(jobs)
  return { cues: assembleJobs(cues, jobs), diagnostics }
}

/** Backward-compatible convenience wrapper; product orchestration uses translateCues. */
export async function translateAllCues(
  cues: Cue[],
  targetLang: string,
  openaiCfg: OpenAIConfig,
  apiKey: string,
  signal?: AbortSignal,
  context?: TranslationContext,
): Promise<Cue[]> {
  const result = await translateCues(cues, targetLang, openaiCfg, apiKey, {
    signal,
    context,
    translation: { mode: 'whole', batchSize: 8 },
  })
  return result.cues
}

async function detectBoundaries(
  cues: Cue[],
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  diagnostics: PipelineDiagnostics,
  onUsage: (usage?: RequestUsage) => Promise<void> | void,
): Promise<boolean[]> {
  if (cues.every((cue) => typeof cue.sentenceEnd === 'boolean')) {
    diagnostics.boundaryMethod = 'timed-punctuation'
    return cues.map((cue) => cue.sentenceEnd as boolean)
  }

  diagnostics.boundaryMethod = 'llm'
  const texts = cues.map((cue) => cue.o)
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= BOUNDARY_RETRIES; attempt++) {
    throwIfAborted(signal)
    try {
      diagnostics.boundaryRequestCount += 1
      const result = await boundaryBatch(texts, cfg, apiKey, signal, onUsage)
      if (result.finishReason === 'length') {
        throw new TruncationError(`Boundary output truncated for ${cues.length} fragments`)
      }
      return parseBoundaries(result.content, cues.length)
    } catch (error) {
      if (signal?.aborted || error instanceof TruncationError) throw error
      lastError = error as Error
      if (attempt < BOUNDARY_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }
  throw lastError ?? new Error('Boundary detection failed')
}

async function translateGroupAdaptive(
  plans: SentencePlan[],
  references: SentenceReference[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  context: TranslationContext | undefined,
  diagnostics: PipelineDiagnostics,
  onUsage: (usage?: RequestUsage) => Promise<void> | void,
): Promise<Map<string, string>> {
  try {
    return await translateCanonicalGroup(
      plans,
      references,
      targetLang,
      cfg,
      apiKey,
      signal,
      context,
      diagnostics,
      onUsage,
    )
  } catch (error) {
    if (!isSplittable(error) || plans.length <= 1) throw error
    const middle = Math.ceil(plans.length / 2)
    const left = await translateGroupAdaptive(
      plans.slice(0, middle), references, targetLang, cfg, apiKey, signal,
      context, diagnostics, onUsage,
    )
    const right = await translateGroupAdaptive(
      plans.slice(middle), references, targetLang, cfg, apiKey, signal,
      context, diagnostics, onUsage,
    )
    return new Map([...left, ...right])
  }
}

async function translateCanonicalGroup(
  plans: SentencePlan[],
  references: SentenceReference[],
  targetLang: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  context: TranslationContext | undefined,
  diagnostics: PipelineDiagnostics,
  onUsage: (usage?: RequestUsage) => Promise<void> | void,
): Promise<Map<string, string>> {
  const ids = plans.map((plan) => plan.id)
  let lastError: Error | undefined
  let previousError: string | undefined
  for (let attempt = 0; attempt < TRANSLATION_RETRIES; attempt++) {
    throwIfAborted(signal)
    diagnostics.translationRequestCount += 1
    try {
      const { system, user } = fillCanonicalPrompt(
        references,
        ids,
        targetLang,
        context,
        previousError,
      )
      const completion = await completePrompt(system, user, cfg, apiKey, signal, {
        role: 'translation',
        onUsage,
      })
      if (completion.finishReason === 'length') {
        throw new TruncationError(`Canonical translation truncated for ${ids.join(', ')}`)
      }
      try {
        const translations = parseGlobalTranslations(completion.content, ids)
        for (const plan of plans) {
          validateCanonicalTarget(plan.sourceText, translations.get(plan.id) ?? '', targetLang)
        }
        return translations
      } catch (error) {
        throw new CountMismatchError((error as Error).message)
      }
    } catch (error) {
      if (signal?.aborted || error instanceof TruncationError) throw error
      lastError = error as Error
      previousError = lastError.message
      if (attempt < TRANSLATION_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }
  throw lastError ?? new Error('Canonical translation failed')
}

async function alignJob(
  job: SentenceJob,
  references: SentenceReference[],
  target: string,
  cfg: OpenAIConfig,
  apiKey: string,
  signal: AbortSignal | undefined,
  context: TranslationContext | undefined,
  diagnostics: PipelineDiagnostics,
  onUsage: (usage?: RequestUsage) => Promise<void> | void,
): Promise<void> {
  const requiredCutCount = job.plan.displayRanges.length - 1
  if (!hasEnoughSafeAlignmentCuts(target, requiredCutCount)) {
    completeFallbackJob(job, target)
    diagnostics.fallbackSentenceCount += 1
    return
  }

  let previousError: string | undefined
  for (let attempt = 0; attempt < ALIGNMENT_ATTEMPTS; attempt++) {
    throwIfAborted(signal)
    const { system, user } = fillAlignmentPrompt(
      references,
      job.plan,
      job.plan.displayTexts,
      target,
      context,
      previousError,
    )
    diagnostics.alignmentRequestCount += 1
    try {
      const completion = await completePrompt(system, user, cfg, apiKey, signal, {
        role: 'alignment',
        jsonOutput: true,
        onUsage,
      })
      if (completion.finishReason === 'length') throw new Error('Alignment output truncated')
      const cuts = parseAlignmentCuts(
        completion.content,
        job.plan.id,
        requiredCutCount,
        target,
      )
      completeAlignedJob(job, target, cuts)
      return
    } catch (error) {
      if (signal?.aborted) throw error
      previousError = (error as Error).message
    }
  }
  completeFallbackJob(job, target)
  diagnostics.fallbackSentenceCount += 1
}
