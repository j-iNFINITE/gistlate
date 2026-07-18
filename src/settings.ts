import { GM_getValue, GM_setValue, GM_deleteValue } from '$'

// ── Types ────────────────────────────────────────────

export interface OpenAIConfig {
  baseUrl: string
  model: string
}

export interface GitHubConfig {
  owner: string
  repo: string
  branch: string
}

export type TranslationMode = 'sentence' | 'batch' | 'whole'

export interface TranslationSettings {
  mode: TranslationMode
  /** Remembered while another mode is selected. Valid range: 2..32. */
  batchSize: number
}

/** Live subtitle overlay styling (driven by CSS custom properties). */
export interface SubtitleTextStyle {
  /** Preset key ('system-sans' | 'serif' | 'mono' | 'yt-noto') or a raw CSS font family. */
  fontFamily: string
  /** Font size (px). */
  size: number
  /** Text color (#rrggbb). */
  color: string
  fontWeight: 400 | 700
}

export interface SubtitlePosition {
  anchor: 'top' | 'bottom'
  /** Distance from the selected anchor as a percentage of player height. */
  percent: number
}

export interface SubtitleStyle {
  original: SubtitleTextStyle
  translated: SubtitleTextStyle
  translationPosition: 'above' | 'below'
  /** Text-shadow / outline strength (0..4; 0 = none). */
  outline: number
  /** Background box opacity behind text (0..0.8). */
  bgOpacity: number
  position: SubtitlePosition
  /** Gap between original and translated lines (px). */
  lineGap: number
}

export interface Settings {
  tgt: string
  displayMode: 'bilingual' | 'original-only' | 'translation-only'
  /** Start each newly navigated Watch video without requiring a player click. */
  autoStart: boolean
  openai: OpenAIConfig
  github: GitHubConfig
  translation: TranslationSettings
  style: SubtitleStyle
}

export type DisplayMode = Settings['displayMode']

// ── Defaults ─────────────────────────────────────────

export const DEFAULTS: Settings = {
  tgt: 'zh-Hans',
  displayMode: 'bilingual',
  autoStart: true,
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  github: {
    owner: '',
    repo: '',
    branch: 'main',
  },
  translation: {
    mode: 'sentence',
    batchSize: 8,
  },
  // Reproduces the MVP overlay look (see ui/overlay.ts OVERLAY_CSS fallbacks).
  style: {
    original: {
      fontFamily: 'yt-noto',
      size: 26,
      color: '#ffffff',
      fontWeight: 400,
    },
    translated: {
      fontFamily: 'yt-noto',
      size: 21,
      color: '#aad6ff',
      fontWeight: 400,
    },
    translationPosition: 'below',
    outline: 2,
    bgOpacity: 0,
    position: { anchor: 'bottom', percent: 10 },
    lineGap: 0,
  },
}

// ── GM storage keys ─────────────────────────────────

const KEY_SETTINGS = 'settings'
const KEY_SECRET_OPENAI = 'secret.openaiKey'
const KEY_SECRET_GITHUB_PAT = 'secret.githubPat'

// ── Read / write helpers ────────────────────────────

export function loadSettings(): Settings {
  const stored = GM_getValue<Record<string, unknown> | undefined>(KEY_SETTINGS, undefined)
  return normalizeSettings(stored)
}

export function saveSettings(s: Settings): void {
  GM_setValue(KEY_SETTINGS, s as unknown as Record<string, unknown>)
}

export function loadOpenAIKey(): string {
  return GM_getValue<string>(KEY_SECRET_OPENAI, '')
}

export function saveOpenAIKey(key: string): void {
  if (key) {
    GM_setValue(KEY_SECRET_OPENAI, key)
  } else {
    GM_deleteValue(KEY_SECRET_OPENAI)
  }
}

export function loadGitHubPat(): string {
  return GM_getValue<string>(KEY_SECRET_GITHUB_PAT, '')
}

export function saveGitHubPat(pat: string): void {
  if (pat) {
    GM_setValue(KEY_SECRET_GITHUB_PAT, pat)
  } else {
    GM_deleteValue(KEY_SECRET_GITHUB_PAT)
  }
}

/** Get all secrets at call sites (never log these). */
export function loadSecrets(): { openaiKey: string; githubPat: string } {
  return {
    openaiKey: loadOpenAIKey(),
    githubPat: loadGitHubPat(),
  }
}

// ── Internals ────────────────────────────────────────

export function normalizeSettings(stored: Record<string, unknown> | undefined): Settings {
  const d = DEFAULTS
  if (!stored) return cloneDefaults()
  return {
    tgt: typeof stored.tgt === 'string' ? stored.tgt : d.tgt,
    displayMode:
      stored.displayMode === 'bilingual' || stored.displayMode === 'original-only' ||
        stored.displayMode === 'translation-only'
        ? stored.displayMode
        : d.displayMode,
    autoStart: typeof stored.autoStart === 'boolean' ? stored.autoStart : d.autoStart,
    openai: {
      baseUrl:
        typeof (stored.openai as OpenAIConfig | undefined)?.baseUrl === 'string'
          ? (stored.openai as OpenAIConfig).baseUrl
          : d.openai.baseUrl,
      model:
        typeof (stored.openai as OpenAIConfig | undefined)?.model === 'string'
          ? (stored.openai as OpenAIConfig).model
          : d.openai.model,
    },
    github: {
      owner:
        typeof (stored.github as GitHubConfig | undefined)?.owner === 'string'
          ? (stored.github as GitHubConfig).owner
          : d.github.owner,
      repo:
        typeof (stored.github as GitHubConfig | undefined)?.repo === 'string'
          ? (stored.github as GitHubConfig).repo
          : d.github.repo,
      branch:
        typeof (stored.github as GitHubConfig | undefined)?.branch === 'string'
          ? (stored.github as GitHubConfig).branch
          : d.github.branch,
    },
    translation: normalizeTranslationSettings(stored.translation),
    style: normalizeSubtitleStyle(stored.style),
  }
}

/** Backward-compatible translation strategy merge for old or malformed settings. */
export function normalizeTranslationSettings(stored: unknown): TranslationSettings {
  const d = DEFAULTS.translation
  const value = stored && typeof stored === 'object'
    ? stored as Record<string, unknown>
    : {}
  const mode = value.mode === 'sentence' || value.mode === 'batch' || value.mode === 'whole'
    ? value.mode
    : d.mode
  const rawBatchSize = typeof value.batchSize === 'number' && Number.isFinite(value.batchSize)
    ? Math.trunc(value.batchSize)
    : d.batchSize
  return {
    mode,
    batchSize: Math.min(32, Math.max(2, rawBatchSize)),
  }
}

/** Backward-compatible style merge from both the old flat and new nested shape. */
export function normalizeSubtitleStyle(stored: unknown): SubtitleStyle {
  const d = DEFAULTS.style
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const original = recordOf(s.original)
  const translated = recordOf(s.translated)
  const position = recordOf(s.position)
  const legacyFont = stringOr(s.fontFamily, d.original.fontFamily)
  const legacyWeight = fontWeightOr(s.fontWeight, d.original.fontWeight)
  return {
    original: {
      fontFamily: stringOr(original.fontFamily, legacyFont),
      size: numberIn(original.size ?? s.originalSize, 12, 64, d.original.size),
      color: stringOr(original.color ?? s.originalColor, d.original.color),
      fontWeight: fontWeightOr(original.fontWeight, legacyWeight),
    },
    translated: {
      fontFamily: stringOr(translated.fontFamily, legacyFont),
      size: numberIn(translated.size ?? s.translatedSize, 12, 64, d.translated.size),
      color: stringOr(translated.color ?? s.translatedColor, d.translated.color),
      fontWeight: fontWeightOr(translated.fontWeight, legacyWeight),
    },
    translationPosition: s.translationPosition === 'above' || s.translationPosition === 'below'
      ? s.translationPosition
      : d.translationPosition,
    outline: numberIn(s.outline, 0, 4, d.outline),
    bgOpacity: numberIn(s.bgOpacity, 0, 0.8, d.bgOpacity),
    position: {
      anchor: position.anchor === 'top' || position.anchor === 'bottom'
        ? position.anchor
        : 'bottom',
      percent: numberIn(position.percent ?? s.bottomOffset, 0, 90, d.position.percent),
    },
    lineGap: numberIn(s.lineGap, 0, 32, d.lineGap),
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function fontWeightOr(value: unknown, fallback: 400 | 700): 400 | 700 {
  return value === 700 ? 700 : value === 400 ? 400 : fallback
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function cloneDefaults(): Settings {
  return {
    ...DEFAULTS,
    openai: { ...DEFAULTS.openai },
    github: { ...DEFAULTS.github },
    translation: { ...DEFAULTS.translation },
    style: {
      ...DEFAULTS.style,
      original: { ...DEFAULTS.style.original },
      translated: { ...DEFAULTS.style.translated },
      position: { ...DEFAULTS.style.position },
    },
  }
}
