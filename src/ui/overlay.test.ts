import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({
  GM_getValue: vi.fn(),
  GM_setValue: vi.fn(),
  GM_deleteValue: vi.fn(),
}))

import { resolveOverlayLines } from './overlay'

describe('pending progressive subtitle display', () => {
  it('keeps the original line and no target in bilingual mode', () => {
    expect(resolveOverlayLines('原始字幕', undefined, 'bilingual')).toEqual({
      original: '原始字幕',
      translated: '',
    })
  })

  it('uses original text as the primary visible line in translation-only mode until translated', () => {
    expect(resolveOverlayLines('原始字幕', undefined, 'translation-only')).toEqual({
      original: '原始字幕',
      translated: '原始字幕',
    })
    expect(resolveOverlayLines('原始字幕', '翻译字幕', 'translation-only').translated).toBe('翻译字幕')
  })
})
