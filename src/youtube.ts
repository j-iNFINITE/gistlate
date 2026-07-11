/**
 * YouTube-specific helpers: video ID extraction, SPA navigation detection,
 * programmatic caption toggling.
 */

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
