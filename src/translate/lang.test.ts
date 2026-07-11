import { describe, it, expect } from 'vitest'
import { langName, normalizeLang } from './lang'

describe('langName', () => {
  it('returns English name for known codes', () => {
    expect(langName('en')).toBe('English')
    expect(langName('zh-Hans')).toBe('Simplified Chinese')
    expect(langName('zh-Hant')).toBe('Traditional Chinese')
  })

  it('falls back to base language code', () => {
    expect(langName('en-US')).toBe('English')
    expect(langName('zh-CN')).toBe('Chinese')
  })

  it('returns the code itself for unknown languages', () => {
    expect(langName('xyz')).toBe('xyz')
  })
})

describe('normalizeLang', () => {
  it('normalizes zh variants', () => {
    expect(normalizeLang('zh-TW')).toBe('zh-Hant')
    expect(normalizeLang('zh-HK')).toBe('zh-Hant')
    expect(normalizeLang('zh-CN')).toBe('zh-Hans')
    expect(normalizeLang('zh-Hans')).toBe('zh-Hans')
    expect(normalizeLang('zh-Hant')).toBe('zh-Hant')
    expect(normalizeLang('zh')).toBe('zh-Hans')
  })

  it('strips country suffix for non-zh codes', () => {
    expect(normalizeLang('en-US')).toBe('en')
    expect(normalizeLang('pt-BR')).toBe('pt')
  })

  it('lowercases', () => {
    expect(normalizeLang('EN')).toBe('en')
    expect(normalizeLang('JA')).toBe('ja')
  })
})
