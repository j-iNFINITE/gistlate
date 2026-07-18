import type { Cue } from './timedtext'

export interface IndexedCue {
  index: number
  cue: Cue
}

export type SrtChannel = 'original' | 'translated'

export class IncompleteTranslatedSrtError extends Error {
  readonly cueNumbers: number[]

  constructor(cueNumbers: number[]) {
    super(`Translated SRT is incomplete at cues: ${cueNumbers.join(', ')}`)
    this.name = 'IncompleteTranslatedSrtError'
    this.cueNumbers = cueNumbers
  }
}

export class InvalidSrtTimelineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSrtTimelineError'
  }
}

/** Search original and translated text while retaining canonical cue indices. */
export function filterTranscriptCues(cues: Cue[], query: string): IndexedCue[] {
  const needle = normalizeSearchText(query)
  const indexed = cues.map((cue, index) => ({ cue, index }))
  if (!needle) return indexed
  return indexed.filter(({ cue }) =>
    normalizeSearchText(cue.o).includes(needle) ||
    normalizeSearchText(cue.t ?? '').includes(needle),
  )
}

/** Format one complete artifact channel as standards-compatible SRT text. */
export function formatSrt(cues: Cue[], channel: SrtChannel): string {
  validateTimeline(cues)
  if (channel === 'translated') {
    const missing = cues
      .map((cue, index) => (!cue.t?.trim() ? index + 1 : undefined))
      .filter((index): index is number => index !== undefined)
    if (missing.length > 0) throw new IncompleteTranslatedSrtError(missing)
  }

  return cues.map((cue, index) => {
    const text = normalizeSrtText(channel === 'translated' ? cue.t as string : cue.o)
    if (!text) throw new InvalidSrtTimelineError(`SRT cue ${index + 1} has empty text`)
    return [
      String(index + 1),
      `${formatSrtTimestamp(cue.s)} --> ${formatSrtTimestamp(cue.s + cue.d)}`,
      text,
    ].join('\n')
  }).join('\n\n') + (cues.length > 0 ? '\n' : '')
}

export function formatSrtTimestamp(valueMs: number): string {
  const total = Math.max(0, Math.round(valueMs))
  const milliseconds = total % 1000
  const totalSeconds = Math.floor(total / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function validateTimeline(cues: Cue[]): void {
  let previousEnd = 0
  cues.forEach((cue, index) => {
    const end = cue.s + cue.d
    if (!Number.isFinite(cue.s) || !Number.isFinite(cue.d) || !Number.isFinite(end) ||
        cue.s < 0 || cue.d <= 0) {
      throw new InvalidSrtTimelineError(`SRT cue ${index + 1} has an invalid timestamp`)
    }
    if (index > 0 && cue.s < previousEnd) {
      throw new InvalidSrtTimelineError(`SRT cue ${index + 1} overlaps the previous cue`)
    }
    previousEnd = end
  })
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

function normalizeSrtText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim()
}
