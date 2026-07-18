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
export interface SubtitleStyle {
  /** Preset key ('system-sans' | 'serif' | 'mono' | 'yt-noto') or a raw CSS font family. */
  fontFamily: string
  /** Original line font size (px). */
  originalSize: number
  /** Translated line font size (px). */
  translatedSize: number
  /** Original line color (#rrggbb). */
  originalColor: string
  /** Translated line color (#rrggbb). */
  translatedColor: string
  /** Font weight (normal / bold). */
  fontWeight: 400 | 700
  /** Text-shadow / outline strength (0..4; 0 = none). */
  outline: number
  /** Background box opacity behind text (0..0.8). */
  bgOpacity: number
  /** Vertical offset from player bottom (%). */
  bottomOffset: number
  /** Gap between original and translated lines (px). */
  lineGap: number
}

export interface Settings {
  tgt: string
  displayMode: 'bilingual' | 'translation-only'
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
    fontFamily: 'yt-noto',
    originalSize: 26,
    translatedSize: 21,
    originalColor: '#ffffff',
    translatedColor: '#aad6ff',
    fontWeight: 400,
    outline: 2,
    bgOpacity: 0,
    bottomOffset: 10,
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
  if (!stored) return { ...DEFAULTS }
  return mergeDefaults(stored)
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

function mergeDefaults(stored: Record<string, unknown>): Settings {
  const d = DEFAULTS
  return {
    tgt: typeof stored.tgt === 'string' ? stored.tgt : d.tgt,
    displayMode:
      stored.displayMode === 'bilingual' || stored.displayMode === 'translation-only'
        ? stored.displayMode
        : d.displayMode,
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
    style: mergeStyle(stored.style),
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

/** Backward-compatible style merge: missing/partial/invalid fields fall back to defaults. */
function mergeStyle(stored: unknown): SubtitleStyle {
  const d = DEFAULTS.style
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  return {
    fontFamily: typeof s.fontFamily === 'string' ? s.fontFamily : d.fontFamily,
    originalSize: typeof s.originalSize === 'number' ? s.originalSize : d.originalSize,
    translatedSize: typeof s.translatedSize === 'number' ? s.translatedSize : d.translatedSize,
    originalColor: typeof s.originalColor === 'string' ? s.originalColor : d.originalColor,
    translatedColor: typeof s.translatedColor === 'string' ? s.translatedColor : d.translatedColor,
    fontWeight: s.fontWeight === 700 ? 700 : s.fontWeight === 400 ? 400 : d.fontWeight,
    outline: typeof s.outline === 'number' ? s.outline : d.outline,
    bgOpacity: typeof s.bgOpacity === 'number' ? s.bgOpacity : d.bgOpacity,
    bottomOffset: typeof s.bottomOffset === 'number' ? s.bottomOffset : d.bottomOffset,
    lineGap: typeof s.lineGap === 'number' ? s.lineGap : d.lineGap,
  }
}
