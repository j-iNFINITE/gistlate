import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({
  GM_getValue: vi.fn(),
  GM_setValue: vi.fn(),
  GM_deleteValue: vi.fn(),
}))

import {
  DEFAULTS,
  normalizeSettings,
  normalizeSubtitleStyle,
  normalizeTranslationSettings,
} from './settings'

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

describe('subtitle display settings migration', () => {
  it('preserves the old flat style appearance while adding new defaults', () => {
    const settings = normalizeSettings({
      displayMode: 'translation-only',
      style: {
        fontFamily: 'serif',
        originalSize: 30,
        translatedSize: 22,
        originalColor: '#eeeeee',
        translatedColor: '#00aaff',
        fontWeight: 700,
        outline: 3,
        bgOpacity: 0.4,
        bottomOffset: 18,
        lineGap: 6,
      },
    })

    expect(settings.autoStart).toBe(true)
    expect(settings.displayMode).toBe('translation-only')
    expect(settings.style).toEqual({
      original: { fontFamily: 'serif', size: 30, color: '#eeeeee', fontWeight: 700 },
      translated: { fontFamily: 'serif', size: 22, color: '#00aaff', fontWeight: 700 },
      translationPosition: 'below',
      outline: 3,
      bgOpacity: 0.4,
      position: { anchor: 'bottom', percent: 18 },
      lineGap: 6,
    })
  })

  it('accepts the new modes/independent styles and clamps malformed numeric values', () => {
    const style = normalizeSubtitleStyle({
      original: { fontFamily: 'mono', size: 100, color: '#fff', fontWeight: 400 },
      translated: { fontFamily: 'serif', size: 4, color: '#abc', fontWeight: 700 },
      translationPosition: 'above',
      outline: 99,
      bgOpacity: -1,
      position: { anchor: 'top', percent: 200 },
      lineGap: 99,
    })
    expect(style).toMatchObject({
      original: { fontFamily: 'mono', size: 64, fontWeight: 400 },
      translated: { fontFamily: 'serif', size: 12, fontWeight: 700 },
      translationPosition: 'above',
      outline: 4,
      bgOpacity: 0,
      position: { anchor: 'top', percent: 90 },
      lineGap: 32,
    })
    expect(normalizeSettings({ displayMode: 'original-only', autoStart: false }).displayMode)
      .toBe('original-only')
    expect(normalizeSettings({ displayMode: 'original-only', autoStart: false }).autoStart)
      .toBe(false)
  })

  it('returns independent default objects so live editing cannot mutate DEFAULTS', () => {
    const first = normalizeSettings(undefined)
    first.style.original.size = 99
    first.style.position.percent = 80
    expect(normalizeSettings(undefined).style).toEqual(DEFAULTS.style)
  })
})
