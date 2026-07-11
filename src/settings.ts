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

export interface Settings {
  tgt: string
  displayMode: 'bilingual' | 'translation-only'
  openai: OpenAIConfig
  github: GitHubConfig
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
  }
}
