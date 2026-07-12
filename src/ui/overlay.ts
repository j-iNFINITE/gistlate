import { loadSettings, saveSettings, type DisplayMode, type SubtitleStyle } from '../settings'

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

// Movement (px) a press must exceed before it counts as a drag (rather than a
// click), so tapping the subtitle text never accidentally repositions it.
const DRAG_THRESHOLD = 4

// Pinned sample shown while the style panel's preview mode is on and no real cue
// is currently on screen, so there is always something to preview.
const SAMPLE_ORIGINAL = 'Sample subtitle text.'
const SAMPLE_TRANSLATED = '示例字幕文本。'

let container: HTMLDivElement | null = null
let originalEl: HTMLDivElement | null = null
let translatedEl: HTMLDivElement | null = null
let stylesEl: HTMLStyleElement | null = null
let previewMode = false
// Watches `#movie_player`'s class to raise/lower the subtitle with the controls.
let classObserver: MutationObserver | null = null
// In-flight drag gesture, or null when not dragging.
let drag: DragState | null = null

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
    transform: translateX(var(--gl-hoffset, 0px));
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

  /* Only the actual text is grabbable (drag to reposition); the container stays
     pointer-events:none so the rest of the video remains clickable. */
  #${CONTAINER_ID} .gl-original,
  #${CONTAINER_ID} .gl-translated {
    pointer-events: auto;
    cursor: move;
    user-select: none;
    touch-action: none;
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
  s.setProperty('--gl-hoffset', `${style.hOffset}px`)
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

// ── Draggable subtitle ───────────────────────────────

interface DragState {
  pointerId: number
  startX: number
  startY: number
  /** bottomOffset (%) / hOffset (px) captured at drag start. */
  baseBottom: number
  baseH: number
  /** Latest applied bottomOffset (%) / hOffset (px), persisted on release. */
  curBottom: number
  curH: number
  /** Movement exceeded DRAG_THRESHOLD → a real drag, not a click. */
  moved: boolean
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function onDragStart(e: PointerEvent): void {
  const st = loadSettings().style
  drag = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    baseBottom: st.bottomOffset,
    baseH: st.hOffset,
    curBottom: st.bottomOffset,
    curH: st.hOffset,
    moved: false,
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onDragMove(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return
  const c = container
  if (!c) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  // Below the threshold this is still a click, not a drag — leave position alone.
  if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
  drag.moved = true
  const player = c.parentElement as HTMLElement | null
  const ph = player?.clientHeight || window.innerHeight
  const pw = player?.clientWidth || window.innerWidth
  // Dragging up (dy < 0) raises the subtitle → larger bottomOffset%.
  drag.curBottom = clamp(drag.baseBottom + (-dy / ph) * 100, 0, 90)
  // Clamp horizontally so the subtitle can't be dragged fully off-screen.
  drag.curH = clamp(drag.baseH + dx, -pw / 2, pw / 2)
  c.style.setProperty('--gl-bottom', `${drag.curBottom}%`)
  c.style.setProperty('--gl-hoffset', `${drag.curH}px`)
}

function onDragEnd(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // Capture may already be released (e.g. on pointercancel) — ignore.
  }
  // Persist only a real drag; a sub-threshold press was a click, leave it be.
  if (drag.moved) {
    const cur = loadSettings()
    saveSettings({
      ...cur,
      style: { ...cur.style, bottomOffset: drag.curBottom, hOffset: drag.curH },
    })
  }
  drag = null
}

/** Wire pointer-based drag onto a grabbable text line (uses pointer capture). */
function attachDrag(el: HTMLElement): void {
  el.addEventListener('pointerdown', onDragStart)
  el.addEventListener('pointermove', onDragMove)
  el.addEventListener('pointerup', onDragEnd)
  el.addEventListener('pointercancel', onDragEnd)
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

  // Raise/lower the subtitle with the control bar, and make the text draggable.
  observeControls(player)
  attachDrag(originalEl)
  attachDrag(translatedEl)

  return getExistingOverlay()
}

function getExistingOverlay(): Overlay {
  return {
    update(original: string, translated?: string) {
      const o = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-original`)
      const t = document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-translated`)
      let orig = original || ''
      let trans = translated || ''
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
      drag = null
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
  drag = null
  container?.remove()
  stylesEl?.remove()
  container = null
  originalEl = null
  translatedEl = null
  stylesEl = null
  previewMode = false
  // Restore native captions
  const native = document.querySelector<HTMLElement>('.ytp-caption-window-container')
  if (native) native.style.display = ''
}
