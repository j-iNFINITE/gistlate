import type { DisplayMode } from '../settings'

/**
 * Bilingual subtitle overlay mounted on `#movie_player`.
 * Hides native caption window and renders original + translated text.
 */

const CONTAINER_ID = 'gistlate-overlay'
const CSS_ID = 'gistlate-styles'

let container: HTMLDivElement | null = null
let originalEl: HTMLDivElement | null = null
let translatedEl: HTMLDivElement | null = null
let stylesEl: HTMLStyleElement | null = null

const OVERLAY_CSS = `
  /* Hide native captions */
  .ytp-caption-window-container { display: none !important; }

  /* Gistlate overlay container */
  #${CONTAINER_ID} {
    position: absolute;
    bottom: 10%;
    left: 0;
    right: 0;
    text-align: center;
    pointer-events: none;
    z-index: 40;
    font-family: "YouTube Noto", Roboto, Arial, sans-serif;
    line-height: 1.4;
  }

  #${CONTAINER_ID} .gl-original {
    font-size: 1.6em;
    color: #fff;
    text-shadow: 2px 2px 4px rgba(0,0,0,.8);
    padding: 2px 8px;
    display: block;
  }

  #${CONTAINER_ID} .gl-translated {
    font-size: 1.3em;
    color: #aad6ff;
    text-shadow: 2px 2px 4px rgba(0,0,0,.8);
    padding: 2px 8px;
    display: block;
  }

  #${CONTAINER_ID}.gl-mode-translation-only .gl-original {
    display: none !important;
  }

  #${CONTAINER_ID}.gl-mode-translation-only .gl-translated {
    color: #fff;
    font-size: 1.6em;
  }
`

export interface Overlay {
  update(original: string, translated?: string): void
  setDisplayMode(mode: DisplayMode): void
  destroy(): void
}

/**
 * Mount the overlay on `#movie_player`.
 * Idempotent: safe to call multiple times.
 */
export function createOverlay(): Overlay | null {
  const player = document.querySelector('#movie_player')
  if (!player) return null

  // Idempotent: don't recreate if already mounted
  if (document.getElementById(CONTAINER_ID)) {
    return getExistingOverlay()
  }

  // Inject styles
  if (!document.getElementById(CSS_ID)) {
    stylesEl = document.createElement('style')
    stylesEl.id = CSS_ID
    stylesEl.textContent = OVERLAY_CSS
    document.head.appendChild(stylesEl)
  }

  // Build overlay DOM
  container = document.createElement('div')
  container.id = CONTAINER_ID

  originalEl = document.createElement('div')
  originalEl.className = 'gl-original'
  translatedEl = document.createElement('div')
  translatedEl.className = 'gl-translated'

  container.appendChild(originalEl)
  container.appendChild(translatedEl)
  player.appendChild(container)

  return getExistingOverlay()
}

function getExistingOverlay(): Overlay {
  return {
    update(original: string, translated?: string) {
      const o = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-original`)
      const t = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-translated`)
      if (o) o.textContent = original || ''
      if (t) {
        t.textContent = translated || ''
        t.style.display = translated ? 'block' : 'none'
      }
    },
    setDisplayMode(mode: DisplayMode) {
      const c = document.getElementById(CONTAINER_ID)
      if (!c) return
      c.classList.toggle('gl-mode-translation-only', mode === 'translation-only')
    },
    destroy() {
      const c = document.getElementById(CONTAINER_ID)
      c?.remove()
      const s = document.getElementById(CSS_ID)
      s?.remove()
      // Restore native captions
      const native = document.querySelector<HTMLElement>('.ytp-caption-window-container')
      if (native) native.style.display = ''
    },
  }
}

/**
 * Clean up when leaving the page or resetting.
 */
export function destroyOverlay(): void {
  container?.remove()
  stylesEl?.remove()
  container = null
  originalEl = null
  translatedEl = null
  stylesEl = null
  // Restore native captions
  const native = document.querySelector<HTMLElement>('.ytp-caption-window-container')
  if (native) native.style.display = ''
}
