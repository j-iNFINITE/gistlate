import { gmFetch } from '../net/gm'
import type { GitHubConfig } from '../settings'
import { repoPath, type CacheKeyInput } from './key'
import type { CacheEntry } from './l1'

const API_BASE = 'https://api.github.com'
const RAW_BASE = 'https://raw.githubusercontent.com'

/**
 * Read a translation artifact from the pool repo (tokenless).
 * 404 = miss. Other errors = treated as miss, logged.
 */
export async function readL2(
  cfg: GitHubConfig,
  keyInput: CacheKeyInput,
): Promise<CacheEntry | undefined> {
  if (!cfg.owner || !cfg.repo) return undefined

  const path = repoPath(keyInput)
  const url = `${RAW_BASE}/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/${path}`

  try {
    const r = await gmFetch({ method: 'GET', url })
    if (r.status === 200) {
      return JSON.parse(r.text) as CacheEntry
    }
    if (r.status === 404) return undefined
    console.warn(`[Gistlate] L2 read returned ${r.status}: ${r.text.slice(0, 100)}`)
    return undefined
  } catch (e) {
    console.warn(`[Gistlate] L2 read error:`, e)
    return undefined
  }
}

/**
 * Write a translation artifact to the pool repo.
 * Requires a PAT with `public_repo` scope.
 * Silently soft-fails on errors (caller keeps L1).
 */
export async function writeL2(
  cfg: GitHubConfig,
  pat: string,
  entry: CacheEntry,
  commitMessage?: string,
): Promise<void> {
  if (!cfg.owner || !cfg.repo || !pat) {
    console.warn('[Gistlate] L2 write skipped: missing config or PAT')
    return
  }

  const path = repoPath(entry)
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(entry, null, 2))))
  const message = commitMessage ?? `Gistlate: ${entry.videoId} ${entry.src}→${entry.tgt}`

  // Get current file SHA for update (404 = new file → no sha)
  let sha: string | undefined
  try {
    const getR = await gmFetch({
      method: 'GET',
      url: `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`,
      headers: { Authorization: `Bearer ${pat}` },
    })
    if (getR.status === 200) {
      const data = JSON.parse(getR.text)
      sha = data.sha
    }
  } catch {
    // 404 or error → new file
  }

  // PUT the file
  try {
    const body = JSON.stringify({
      message,
      content,
      branch: cfg.branch || 'main',
      ...(sha ? { sha } : {}),
    })
    const r = await gmFetch({
      method: 'PUT',
      url: `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pat}`,
      },
      body,
    })
    if (r.status >= 200 && r.status < 300) {
      console.log(`[Gistlate] L2 write OK: ${path}`)
    } else {
      console.warn(`[Gistlate] L2 write returned ${r.status}: ${r.text.slice(0, 200)}`)
    }
  } catch (e) {
    console.warn('[Gistlate] L2 write error:', e)
    // Soft-fail: caller keeps L1
  }
}
