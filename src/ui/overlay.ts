import { loadSettings, type DisplayMode, type SubtitleStyle } from '../settings'

/**
 * Bilingual subtitle overlay mounted on `#movie_player`.
 * Hides native caption window and renders original + translated text.
 *
 * Styling is driven by CSS custom properties (`--gl-*`) set on the container,
 * so `applyStyle()` restyles the live subtitles instantly with no re-render.
 */

const CONTAINER_ID = 'gistlate-overlay'
const CSS_ID = 'gistlate-styles'

// Extra bottom offset (px) applied while YouTube's control bar is shown, so the
// subtitle is not hidden behind the progress bar + control row.
const CTRL_OFFSET = 56

// Pinned sample shown while the style panel's preview mode is on and no real cue
// is currently on screen, so there is always something to preview.
const SAMPLE_ORIGINAL = 'Sample subtitle text.'
const SAMPLE_TRANSLATED = '示例字幕文本。'

let container: HTMLDivElement | null = null
let originalEl: HTMLDivElement | null = null
let translatedEl: HTMLDivElement | null = null
let stylesEl: HTMLStyleElement | null = null
let previewMode = false
let currentDisplayMode: DisplayMode = 'bilingual'
// Watches `#movie_player`'s class to raise/lower the subtitle with the controls.
let classObserver: MutationObserver | null = null

const OVERLAY_CSS = `
  /* Hide native captions */
  .ytp-caption-window-container { display: none !important; }

  /* Gistlate overlay container */
  #${CONTAINER_ID} {
    position: absolute;
    bottom: calc(var(--gl-bottom, 10%) + var(--gl-ctrl-offset, 0px));
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gl-gap, 0px);
    text-align: center;
    pointer-events: none;
    z-index: 40;
    font-family: var(--gl-font, "YouTube Noto", Roboto, Arial, sans-serif);
    line-height: 1.4;
  }

  #${CONTAINER_ID} .gl-original {
    max-width: 90%;
    font-size: var(--gl-o-size, 26px);
    color: var(--gl-o-color, #fff);
    font-weight: var(--gl-weight, 400);
    text-shadow: var(--gl-shadow, 2px 2px 4px rgba(0,0,0,.8));
    background: var(--gl-bg, transparent);
    padding: 2px 8px;
  }

  #${CONTAINER_ID} .gl-translated {
    max-width: 90%;
    font-size: var(--gl-t-size, 21px);
    color: var(--gl-t-color, #aad6ff);
    font-weight: var(--gl-weight, 400);
    text-shadow: var(--gl-shadow, 2px 2px 4px rgba(0,0,0,.8));
    background: var(--gl-bg, transparent);
    padding: 2px 8px;
  }

  #${CONTAINER_ID}.gl-mode-translation-only .gl-original {
    display: none !important;
  }

  #${CONTAINER_ID}.gl-mode-translation-only .gl-translated {
    color: var(--gl-o-color, #fff);
    font-size: var(--gl-o-size, 26px);
  }
`

// ── Style mapping helpers ────────────────────────────

const FONT_STACKS: Record<string, string> = {
  'system-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SF Mono", SFMono-Regular, Consolas, "Courier New", monospace',
  'yt-noto': '"YouTube Noto", Roboto, Arial, sans-serif',
}

/** Preset key → concrete font stack; a non-preset value is treated as a raw family. */
function fontStack(family: string): string {
  return FONT_STACKS[family] ?? family
}

/**
 * Outline/shadow strength → CSS `text-shadow`.
 * At the default strength (2) this reproduces the MVP `2px 2px 4px rgba(0,0,0,.8)`.
 */
function shadowFor(strength: number): string {
  if (strength <= 0) return 'none'
  return `${strength}px ${strength}px ${strength * 2}px rgba(0,0,0,.8)`
}

/** Map a SubtitleStyle onto the container's CSS custom properties. */
function applyStyleToContainer(style: SubtitleStyle): void {
  const c = container ?? document.getElementById(CONTAINER_ID)
  if (!c) return
  const s = (c as HTMLElement).style
  s.setProperty('--gl-font', fontStack(style.fontFamily))
  s.setProperty('--gl-o-size', `${style.originalSize}px`)
  s.setProperty('--gl-t-size', `${style.translatedSize}px`)
  s.setProperty('--gl-o-color', style.originalColor)
  s.setProperty('--gl-t-color', style.translatedColor)
  s.setProperty('--gl-weight', String(style.fontWeight))
  s.setProperty('--gl-shadow', shadowFor(style.outline))
  s.setProperty('--gl-bg', `rgba(0,0,0,${style.bgOpacity})`)
  s.setProperty('--gl-bottom', `${style.bottomOffset}%`)
  s.setProperty('--gl-gap', `${style.lineGap}px`)
}

// ── Control-bar-aware positioning ────────────────────

/**
 * Raise the subtitle while YouTube's control bar is shown; lower it when the
 * controls auto-hide. YouTube toggles the `ytp-autohide` class on `#movie_player`
 * (present = controls hidden; absent = controls shown).
 */
function updateCtrlOffset(player: Element): void {
  const c = container ?? document.getElementById(CONTAINER_ID)
  if (!c) return
  const shown = !player.classList.contains('ytp-autohide')
  ;(c as HTMLElement).style.setProperty('--gl-ctrl-offset', shown ? `${CTRL_OFFSET}px` : '0px')
}

/** Observe the player's class to keep `--gl-ctrl-offset` in sync; init once. */
function observeControls(player: Element): void {
  classObserver?.disconnect()
  classObserver = new MutationObserver(() => updateCtrlOffset(player))
  classObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
  updateCtrlOffset(player)
}

export interface Overlay {
  update(original: string, translated?: string): void
  setDisplayMode(mode: DisplayMode): void
  /** Restyle the live subtitles instantly by writing CSS custom properties. */
  applyStyle(style: SubtitleStyle): void
  /** When enabled, an empty playhead shows a pinned sample cue for preview. */
  setPreviewMode(on: boolean): void
  destroy(): void
}

export function resolveOverlayLines(
  original: string,
  translated: string | undefined,
  mode: DisplayMode,
): { original: string; translated: string } {
  const normalizedOriginal = original || ''
  return {
    original: normalizedOriginal,
    translated: translated || (mode === 'translation-only' ? normalizedOriginal : ''),
  }
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

  // Apply the persisted subtitle style on mount.
  applyStyleToContainer(loadSettings().style)

  // Raise/lower the subtitle with the control bar.
  observeControls(player)

  return getExistingOverlay()
}

function getExistingOverlay(): Overlay {
  return {
    update(original: string, translated?: string) {
      const o = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-original`)
      const t = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-translated`)
      const lines = resolveOverlayLines(original, translated, currentDisplayMode)
      let orig = lines.original
      let trans = lines.translated
      // In preview mode, pin a sample cue whenever the playhead has nothing.
      if (previewMode && !orig && !trans) {
        orig = SAMPLE_ORIGINAL
        trans = SAMPLE_TRANSLATED
      }
      if (o) o.textContent = orig
      if (t) {
        t.textContent = trans
        t.style.display = trans ? 'block' : 'none'
      }
    },
    setDisplayMode(mode: DisplayMode) {
      currentDisplayMode = mode
      const c = document.getElementById(CONTAINER_ID)
      if (!c) return
      c.classList.toggle('gl-mode-translation-only', mode === 'translation-only')
    },
    applyStyle(style: SubtitleStyle) {
      applyStyleToContainer(style)
    },
    setPreviewMode(on: boolean) {
      previewMode = on
      const o = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-original`)
      const t = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-translated`)
      if (!o || !t) return
      if (on) {
        // Show the sample immediately if nothing is currently on screen.
        if (!o.textContent && !t.textContent) {
          o.textContent = SAMPLE_ORIGINAL
          t.textContent = SAMPLE_TRANSLATED
          t.style.display = 'block'
        }
      } else if (o.textContent === SAMPLE_ORIGINAL && t.textContent === SAMPLE_TRANSLATED) {
        // Clear the sample we pinned (leave real cues untouched).
        o.textContent = ''
        t.textContent = ''
        t.style.display = 'none'
      }
    },
    destroy() {
      classObserver?.disconnect()
      classObserver = null
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
  classObserver?.disconnect()
  classObserver = null
  container?.remove()
  stylesEl?.remove()
  container = null
  originalEl = null
  translatedEl = null
  stylesEl = null
  previewMode = false
  currentDisplayMode = 'bilingual'
  // Restore native captions
  const native = document.querySelector<HTMLElement>('.ytp-caption-window-container')
  if (native) native.style.display = ''
}
