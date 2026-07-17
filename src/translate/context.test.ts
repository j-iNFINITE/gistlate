import { describe, expect, it } from 'vitest'
import {
  MAX_CONTEXT_DESCRIPTION_CHARS,
  MAX_CONTEXT_TITLE_CHARS,
  normalizeTranslationContext,
} from './context'

describe('normalizeTranslationContext', () => {
  it('collapses whitespace, trims values, and omits empty fields', () => {
    expect(
      normalizeTranslationContext({
        title: '  A\n video\t title  ',
        description: ' \n\t ',
      }),
    ).toEqual({ title: 'A video title' })
  })

  it('caps title and description by Unicode code points', () => {
    const title = '😀'.repeat(MAX_CONTEXT_TITLE_CHARS + 5)
    const description = '介'.repeat(MAX_CONTEXT_DESCRIPTION_CHARS + 5)

    const normalized = normalizeTranslationContext({ title, description })

    expect(Array.from(normalized.title ?? '')).toHaveLength(MAX_CONTEXT_TITLE_CHARS)
    expect(Array.from(normalized.description ?? '')).toHaveLength(
      MAX_CONTEXT_DESCRIPTION_CHARS,
    )
    expect(normalized.title?.endsWith('😀')).toBe(true)
  })

  it('returns an empty object when context is absent', () => {
    expect(normalizeTranslationContext()).toEqual({})
    expect(normalizeTranslationContext(null)).toEqual({})
  })
})
