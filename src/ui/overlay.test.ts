import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({
  GM_getValue: vi.fn(),
  GM_setValue: vi.fn(),
  GM_deleteValue: vi.fn(),
}))

import { directionForLanguage, positionFromTop, resolveOverlayLines } from './overlay'

describe('pending progressive subtitle display', () => {
  it('keeps the original line and no target in bilingual mode', () => {
    expect(resolveOverlayLines('原始字幕', undefined, 'bilingual')).toEqual({
      original: '原始字幕',
      translated: '',
    })
  })

  it('uses original text as the primary visible line in translation-only mode until translated', () => {
    expect(resolveOverlayLines('原始字幕', undefined, 'translation-only')).toEqual({
      original: '',
      translated: '原始字幕',
    })
    expect(resolveOverlayLines('原始字幕', '翻译字幕', 'translation-only').translated).toBe('翻译字幕')
  })

  it('supports original-only and avoids duplicate bilingual lines', () => {
    expect(resolveOverlayLines('source', 'target', 'original-only')).toEqual({
      original: 'source',
      translated: '',
    })
    expect(resolveOverlayLines('same', 'same', 'bilingual')).toEqual({
      original: 'same',
      translated: '',
    })
  })

  it('renders target-language manual captions once without requiring translation', () => {
    expect(resolveOverlayLines('现成中文字幕', undefined, 'bilingual', true)).toEqual({
      original: '',
      translated: '现成中文字幕',
    })
  })
})

describe('subtitle language direction', () => {
  it('marks RTL languages and keeps known LTR languages left-to-right', () => {
    expect(directionForLanguage('ar-SA')).toBe('rtl')
    expect(directionForLanguage('he')).toBe('rtl')
    expect(directionForLanguage('zh-Hans')).toBe('ltr')
    expect(directionForLanguage()).toBe('auto')
  })
})

describe('anchored subtitle position', () => {
  it('uses a top anchor above the midpoint and a bottom anchor below it', () => {
    expect(positionFromTop(80, 100, 800, 60)).toEqual({ anchor: 'top', percent: 10 })
    expect(positionFromTop(620, 100, 800, 60)).toEqual({
      anchor: 'bottom',
      percent: 2.5,
    })
  })

  it('clamps dragged positions inside the player and reserves visible controls', () => {
    expect(positionFromTop(-50, 100, 800, 60)).toEqual({ anchor: 'top', percent: 0 })
    expect(positionFromTop(999, 100, 800, 60)).toEqual({ anchor: 'bottom', percent: 0 })
    expect(positionFromTop(10, 20, 0, 60)).toEqual({ anchor: 'bottom', percent: 0 })
  })
})
