/** Reference-only video metadata supplied to subtitle translation requests. */
export interface TranslationContext {
  title?: string
  description?: string
}

/** Keep uploader metadata useful without allowing it to dominate the prompt. */
export const MAX_CONTEXT_TITLE_CHARS = 300
export const MAX_CONTEXT_DESCRIPTION_CHARS = 2000

/**
 * Normalize the shared translation-context contract at its boundary.
 *
 * Uses Unicode code points rather than UTF-16 code units so a truncation never
 * cuts a surrogate pair in half. Empty fields are omitted from the result.
 */
export function normalizeTranslationContext(
  context?: TranslationContext | null,
): TranslationContext {
  if (!context) return {}

  const title = normalizeField(context.title, MAX_CONTEXT_TITLE_CHARS)
  const description = normalizeField(
    context.description,
    MAX_CONTEXT_DESCRIPTION_CHARS,
  )

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  }
}

function normalizeField(value: string | undefined, maxChars: number): string {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  return Array.from(normalized).slice(0, maxChars).join('')
}
