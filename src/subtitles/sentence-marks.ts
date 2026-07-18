const SENTENCE_MARK_RE = /[.!?\u3002\uff01\uff1f]/u
const SENTENCE_MARKS_GLOBAL_RE = /[.!?\u3002\uff01\uff1f]/gu
const LEADING_SENTENCE_MARKS_RE = /^[.!?\u3002\uff01\uff1f]+/u

export function isSentenceMark(value: string): boolean {
  return SENTENCE_MARK_RE.test(value)
}

export function countSentenceMarks(value: string): number {
  return value.match(SENTENCE_MARKS_GLOBAL_RE)?.length ?? 0
}

export function leadingSentenceMarks(value: string): string | undefined {
  return value.match(LEADING_SENTENCE_MARKS_RE)?.[0]
}
