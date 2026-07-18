import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({
  GM_getValue: vi.fn(),
  GM_setValue: vi.fn(),
  GM_deleteValue: vi.fn(),
}))

import { DEFAULTS, normalizeTranslationSettings } from './settings'

describe('translation settings', () => {
  it('defaults older settings to sentence mode with remembered batch size 8', () => {
    expect(DEFAULTS.translation).toEqual({ mode: 'sentence', batchSize: 8 })
    expect(normalizeTranslationSettings(undefined)).toEqual(DEFAULTS.translation)
  })

  it.each(['sentence', 'batch', 'whole'] as const)('accepts mode %s', (mode) => {
    expect(normalizeTranslationSettings({ mode, batchSize: 12 })).toEqual({ mode, batchSize: 12 })
  })

  it('rejects unknown modes and clamps integer batch size to 2..32', () => {
    expect(normalizeTranslationSettings({ mode: 'unsafe', batchSize: 1.9 })).toEqual({
      mode: 'sentence',
      batchSize: 2,
    })
    expect(normalizeTranslationSettings({ mode: 'batch', batchSize: 99 })).toEqual({
      mode: 'batch',
      batchSize: 32,
    })
  })
})
