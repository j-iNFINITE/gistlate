/**
 * BCP-47 language code → human-readable name.
 * Used in LLM prompts so the model knows the target language.
 */

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  'pt-BR': 'Brazilian Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
}

export function langName(code: string): string {
  return LANG_NAMES[code] ?? LANG_NAMES[code.split('-')[0]] ?? code
}

/**
 * Normalize a BCP-47 language code.
 * - lowercases
 * - zh-HK → zh-Hant, zh-TW → zh-Hant, zh-CN → zh-Hans
 */
export function normalizeLang(code: string): string {
  const c = code.toLowerCase()
  if (c.startsWith('zh')) {
    if (c.includes('hk') || c.includes('tw') || c.includes('hant')) return 'zh-Hant'
    return 'zh-Hans'
  }
  if (c.includes('-')) {
    const [base] = c.split('-', 1)
    return base
  }
  return c
}
