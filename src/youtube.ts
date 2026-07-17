import { unsafeWindow } from '$'
import {
  normalizeTranslationContext,
  type TranslationContext,
} from './translate/context'

/**
 * YouTube-specific helpers: video ID extraction, SPA navigation detection,
 * programmatic caption toggling.
 */

interface PlayerResponse {
  videoDetails?: {
    videoId?: string
    title?: string
    shortDescription?: string
  }
}

let videoIdCache: string | null = null

/** Extract the current video ID from the YouTube page URL. */
export function getVideoId(): string | null {
  const m = location.pathname.match(/^\/watch$/)
  if (!m) return null
  const v = new URLSearchParams(location.search).get('v')
  return v ?? null
}

/** Get the player element. */
export function getPlayer(): HTMLElement | null {
  return document.querySelector('#movie_player')
}

/** Get the native <video> element inside the player. */
export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('#movie_player video')
}

/**
 * Read reference-only metadata for the current watch video.
 *
 * YouTube may leave the previous `ytInitialPlayerResponse` visible briefly
 * during SPA navigation, so player-response metadata is accepted only when its
 * video ID matches the expected/current URL. DOM metadata is a soft fallback.
 */
export function getVideoContext(
  expectedVideoId: string | null = getVideoId(),
): TranslationContext {
  const pageWindow = unsafeWindow as typeof unsafeWindow & {
    ytInitialPlayerResponse?: PlayerResponse
  }
  const details = pageWindow.ytInitialPlayerResponse?.videoDetails
  const matchingDetails =
    expectedVideoId && details?.videoId === expectedVideoId ? details : undefined

  const title =
    matchingDetails?.title ||
    firstMetaContent(['meta[itemprop="name"]', 'meta[property="og:title"]']) ||
    document.title.replace(/\s*-\s*YouTube\s*$/i, '')
  const description =
    matchingDetails?.shortDescription ||
    firstMetaContent([
      'meta[itemprop="description"]',
      'meta[property="og:description"]',
      'meta[name="description"]',
    ])

  return normalizeTranslationContext({ title, description })
}

function firstMetaContent(selectors: string[]): string {
  for (const selector of selectors) {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content
    if (content?.trim()) return content
  }
  return ''
}

/**
 * Check whether the current page has a captions button available.
 */
export function hasCaptions(): boolean {
  return !!document.querySelector('.ytp-subtitles-button')
}

/**
 * Programmatically enable captions if they are off.
 */
export function ensureCaptions(): boolean {
  const btn = document.querySelector<HTMLElement>(
    '.ytp-subtitles-button[aria-pressed="false"]',
  )
  if (btn) {
    btn.click()
    return true
  }
  return false
}

/**
 * Listen for YouTube SPA navigation.
 * Returns a cleanup function.
 */
export function onNavigate(handler: () => void): () => void {
  document.addEventListener('yt-navigate-finish', handler)
  return () => document.removeEventListener('yt-navigate-finish', handler)
}

/**
 * Watch for video ID changes (re-export of onNavigate with ID tracking).
 * Only fires the handler when the video actually changes.
 */
export function onVideoChange(handler: () => void): () => void {
  return onNavigate(() => {
    const id = getVideoId()
    if (id && id !== videoIdCache) {
      videoIdCache = id
      handler()
    }
  })
}

/** Reset the cached video ID (for cleanup). */
export function resetVideoId(): void {
  videoIdCache = null
}
