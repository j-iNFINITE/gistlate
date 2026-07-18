import {
  loadSettings,
  saveSettings,
  type DisplayMode,
  type SubtitlePosition,
  type SubtitleStyle,
} from '../settings'

/** Player-sized, click-through bilingual subtitle overlay. */
const CONTAINER_ID = 'gistlate-overlay'
const CSS_ID = 'gistlate-styles'
const ACTIVE_CLASS = 'gistlate-active'
const CTRL_OFFSET_FALLBACK = 56
const SAMPLE_ORIGINAL = 'Sample subtitle text.'
const SAMPLE_TRANSLATED = '示例字幕文本。'

let container: HTMLDivElement | null = null
let stackEl: HTMLDivElement | null = null
let originalEl: HTMLDivElement | null = null
let translatedEl: HTMLDivElement | null = null
let stylesEl: HTMLStyleElement | null = null
let previewMode = false
let currentDisplayMode: DisplayMode = 'bilingual'
let currentPosition: SubtitlePosition = { anchor: 'bottom', percent: 10 }
let classObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let dragCleanup: (() => void) | null = null
let lastUpdate: OverlayUpdate = { original: '' }

const OVERLAY_CSS = `
  .${ACTIVE_CLASS} .ytp-caption-window-container { display: none !important; }

  #${CONTAINER_ID} {
    position: absolute; inset: 0; overflow: hidden;
    pointer-events: none; z-index: 9999;
    font-family: "YouTube Noto", Roboto, Arial, sans-serif;
  }
  #${CONTAINER_ID} .gl-stack {
    position: absolute; left: 0; right: 0;
    display: flex; flex-direction: column; align-items: center;
    gap: 2px; text-align: center; pointer-events: none;
  }
  #${CONTAINER_ID} .gl-drag-handle {
    pointer-events: auto; cursor: grab; user-select: none; touch-action: none;
    min-width: 34px; height: 14px; line-height: 10px; box-sizing: border-box;
    border: 0; border-radius: 6px; padding: 0 8px;
    background: rgba(0,0,0,.62); color: rgba(255,255,255,.9);
    font: 700 14px/10px Arial, sans-serif; opacity: .18;
    transition: opacity .15s; z-index: 2;
  }
  #${CONTAINER_ID} .gl-drag-handle:hover,
  #${CONTAINER_ID} .gl-drag-handle:focus-visible,
  #${CONTAINER_ID} .gl-drag-handle.gl-dragging { opacity: 1; }
  #${CONTAINER_ID} .gl-drag-handle.gl-dragging { cursor: grabbing; }
  #${CONTAINER_ID} .gl-text-box {
    display: flex; flex-direction: column; align-items: center;
    gap: var(--gl-gap, 0px); max-width: 90%; box-sizing: border-box;
    border-radius: 5px; padding: 3px 8px;
    background: var(--gl-bg, transparent); pointer-events: none;
  }
  #${CONTAINER_ID} .gl-original,
  #${CONTAINER_ID} .gl-translated {
    max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere;
    line-height: 1.4; text-shadow: var(--gl-shadow, 2px 2px 4px rgba(0,0,0,.8));
  }
  #${CONTAINER_ID} .gl-original {
    font-family: var(--gl-o-font, "YouTube Noto", Roboto, Arial, sans-serif);
    font-size: var(--gl-o-size, 26px); color: var(--gl-o-color, #fff);
    font-weight: var(--gl-o-weight, 400);
  }
  #${CONTAINER_ID} .gl-translated {
    font-family: var(--gl-t-font, "YouTube Noto", Roboto, Arial, sans-serif);
    font-size: var(--gl-t-size, 21px); color: var(--gl-t-color, #aad6ff);
    font-weight: var(--gl-t-weight, 400);
  }
`

const FONT_STACKS: Record<string, string> = {
  'system-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SF Mono", SFMono-Regular, Consolas, "Courier New", monospace',
  'yt-noto': '"YouTube Noto", Roboto, Arial, sans-serif',
}

const RTL_LANGUAGES = new Set([
  'ar', 'arc', 'ckb', 'dv', 'fa', 'he', 'ku', 'nqo', 'ps', 'sd', 'syr', 'ug', 'ur', 'yi',
])

export interface OverlayUpdate {
  original: string
  translated?: string
  sourceLang?: string
  targetLang?: string
  /** Existing human captions already match the target language. */
  directTarget?: boolean
}

export interface Overlay {
  update(original: string, translated?: string, options?: Omit<OverlayUpdate, 'original' | 'translated'>): void
  setDisplayMode(mode: DisplayMode): void
  applyStyle(style: SubtitleStyle): void
  setPreviewMode(on: boolean): void
  setActive(active: boolean): void
  destroy(): void
}

export function resolveOverlayLines(
  original: string,
  translated: string | undefined,
  mode: DisplayMode,
  directTarget = false,
): { original: string; translated: string } {
  const source = original || ''
  const target = translated || ''
  if (directTarget) return { original: '', translated: target || source }
  if (mode === 'original-only') return { original: source, translated: '' }
  if (mode === 'translation-only') return { original: '', translated: target || source }
  if (target && target === source) return { original: source, translated: '' }
  return { original: source, translated: target }
}

export function directionForLanguage(language?: string): 'ltr' | 'rtl' | 'auto' {
  if (!language) return 'auto'
  const base = language.toLowerCase().split('-')[0]
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr'
}

export function createOverlay(): Overlay | null {
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (!player) return null
  const existing = document.getElementById(CONTAINER_ID)
  if (existing instanceof HTMLDivElement) {
    container = existing
    stackEl = existing.querySelector<HTMLDivElement>('.gl-stack')
    originalEl = existing.querySelector<HTMLDivElement>('.gl-original')
    translatedEl = existing.querySelector<HTMLDivElement>('.gl-translated')
    stylesEl = document.getElementById(CSS_ID) as HTMLStyleElement | null
    return getExistingOverlay()
  }

  injectStyles()
  container = document.createElement('div')
  container.id = CONTAINER_ID
  stackEl = document.createElement('div')
  stackEl.className = 'gl-stack'

  const handle = document.createElement('button')
  handle.type = 'button'
  handle.className = 'gl-drag-handle'
  handle.textContent = '━'
  handle.title = '拖动字幕位置'
  handle.setAttribute('aria-label', '拖动字幕位置')

  const textBox = document.createElement('div')
  textBox.className = 'gl-text-box'
  originalEl = document.createElement('div')
  originalEl.className = 'gl-original'
  translatedEl = document.createElement('div')
  translatedEl.className = 'gl-translated'
  textBox.append(originalEl, translatedEl)
  stackEl.append(handle, textBox)
  container.appendChild(stackEl)
  player.appendChild(container)

  const settings = loadSettings()
  currentDisplayMode = settings.displayMode
  applyStyleToContainer(settings.style)
  observePlayer(player)
  installVerticalDrag(handle, player)
  paintLastUpdate()
  return getExistingOverlay()
}

function getExistingOverlay(): Overlay {
  return {
    update(original, translated, options = {}) {
      lastUpdate = { original, translated, ...options }
      paintLastUpdate()
    },
    setDisplayMode(mode) {
      currentDisplayMode = mode
      paintLastUpdate()
    },
    applyStyle(style) {
      applyStyleToContainer(style)
    },
    setPreviewMode(on) {
      previewMode = on
      paintLastUpdate()
    },
    setActive(active) {
      setNativeCaptionsHidden(active)
      const root = document.getElementById(CONTAINER_ID)
      if (root) root.style.display = active ? '' : 'none'
    },
    destroy() {
      destroyOverlay()
    },
  }
}

function paintLastUpdate(): void {
  const original = originalEl ?? document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-original`)
  const translated = translatedEl ?? document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-translated`)
  if (!original || !translated) return

  const update = previewMode && !lastUpdate.original && !lastUpdate.translated
    ? { original: SAMPLE_ORIGINAL, translated: SAMPLE_TRANSLATED }
    : lastUpdate
  const lines = resolveOverlayLines(
    update.original,
    update.translated,
    currentDisplayMode,
    update.directTarget,
  )
  original.textContent = lines.original
  translated.textContent = lines.translated
  original.style.display = lines.original ? 'block' : 'none'
  translated.style.display = lines.translated ? 'block' : 'none'
  setLanguageAttributes(original, update.sourceLang)
  const translatedLanguage = update.directTarget
    ? update.sourceLang
    : update.translated
      ? update.targetLang
      : update.sourceLang
  setLanguageAttributes(translated, translatedLanguage)
}

function setLanguageAttributes(element: HTMLElement, language?: string): void {
  if (language) element.lang = language
  else element.removeAttribute('lang')
  element.dir = directionForLanguage(language)
}

function injectStyles(): void {
  if (document.getElementById(CSS_ID)) return
  stylesEl = document.createElement('style')
  stylesEl.id = CSS_ID
  stylesEl.textContent = OVERLAY_CSS
  document.head.appendChild(stylesEl)
}

function fontStack(family: string): string {
  return FONT_STACKS[family] ?? family
}

function shadowFor(strength: number): string {
  if (strength <= 0) return 'none'
  return `${strength}px ${strength}px ${strength * 2}px rgba(0,0,0,.8)`
}

function applyStyleToContainer(style: SubtitleStyle): void {
  const root = container ?? document.getElementById(CONTAINER_ID)
  const stack = stackEl ?? document.querySelector<HTMLDivElement>(`#${CONTAINER_ID} .gl-stack`)
  if (!root || !stack) return
  currentPosition = { ...style.position }
  root.style.setProperty('--gl-o-font', fontStack(style.original.fontFamily))
  root.style.setProperty('--gl-t-font', fontStack(style.translated.fontFamily))
  root.style.setProperty('--gl-o-size', `${style.original.size}px`)
  root.style.setProperty('--gl-t-size', `${style.translated.size}px`)
  root.style.setProperty('--gl-o-color', style.original.color)
  root.style.setProperty('--gl-t-color', style.translated.color)
  root.style.setProperty('--gl-o-weight', String(style.original.fontWeight))
  root.style.setProperty('--gl-t-weight', String(style.translated.fontWeight))
  root.style.setProperty('--gl-shadow', shadowFor(style.outline))
  root.style.setProperty('--gl-bg', `rgba(0,0,0,${style.bgOpacity})`)
  root.style.setProperty('--gl-gap', `${style.lineGap}px`)
  const original = originalEl ?? document.querySelector<HTMLElement>(`#${CONTAINER_ID} .gl-original`)
  const translated = translatedEl ?? document.querySelector<HTMLElement>(`#${CONTAINER_ID} .gl-translated`)
  if (original && translated) {
    const translationAbove = style.translationPosition === 'above'
    original.style.order = translationAbove ? '2' : '1'
    translated.style.order = translationAbove ? '1' : '2'
  }
  applyPosition(stack, currentPosition, currentControlOffset())
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (player) clampCurrentPosition(player)
}

function cloneStyle(style: SubtitleStyle): SubtitleStyle {
  return {
    ...style,
    original: { ...style.original },
    translated: { ...style.translated },
    position: { ...style.position },
  }
}

function applyPosition(stack: HTMLElement, position: SubtitlePosition, controlOffsetPx: number): void {
  if (position.anchor === 'top') {
    stack.style.top = `${position.percent}%`
    stack.style.bottom = 'auto'
  } else {
    stack.style.top = 'auto'
    stack.style.bottom = `calc(${position.percent}% + ${controlOffsetPx}px)`
  }
}

function observePlayer(player: HTMLElement): void {
  classObserver?.disconnect()
  classObserver = new MutationObserver(() => {
    if (stackEl) applyPosition(stackEl, currentPosition, currentControlOffset())
  })
  classObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
  resizeObserver?.disconnect()
  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    clampCurrentPosition(player)
  })
  resizeObserver?.observe(player)
}

function currentControlOffset(): number {
  return currentPosition.anchor === 'bottom' ? visibleControlOffset() : 0
}

function visibleControlOffset(): number {
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (!player || player.classList.contains('ytp-autohide')) return 0
  const progress = player.querySelector<HTMLElement>('.ytp-progress-bar-container')
  const controlsRegion = progress?.parentElement
  const measured = controlsRegion?.getBoundingClientRect().height
  return measured && measured > 0 ? Math.round(measured) : CTRL_OFFSET_FALLBACK
}

function clampCurrentPosition(player: HTMLElement): void {
  const stack = stackEl
  if (!stack) return
  const playerRect = player.getBoundingClientRect()
  const stackRect = stack.getBoundingClientRect()
  if (playerRect.height <= 0 || stackRect.height <= 0) return
  const reserved = currentPosition.anchor === 'bottom' ? visibleControlOffset() : 0
  const maxPercent = Math.max(
    0,
    ((playerRect.height - stackRect.height - reserved) / playerRect.height) * 100,
  )
  if (currentPosition.percent > maxPercent) {
    currentPosition = { ...currentPosition, percent: maxPercent }
    applyPosition(stack, currentPosition, currentControlOffset())
  }
}

function installVerticalDrag(handle: HTMLButtonElement, player: HTMLElement): void {
  dragCleanup?.()
  let dragging = false
  let pointerId = -1
  let startY = 0
  let startTop = 0

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !stackEl) return
    const playerRect = player.getBoundingClientRect()
    const stackRect = stackEl.getBoundingClientRect()
    dragging = true
    pointerId = event.pointerId
    startY = event.clientY
    startTop = stackRect.top - playerRect.top
    handle.classList.add('gl-dragging')
    handle.setPointerCapture?.(pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId || !stackEl) return
    const playerRect = player.getBoundingClientRect()
    const stackRect = stackEl.getBoundingClientRect()
    if (playerRect.height <= 0) return
    const maxTop = Math.max(0, playerRect.height - stackRect.height)
    const top = Math.min(maxTop, Math.max(0, startTop + event.clientY - startY))
    currentPosition = positionFromTop(
      top,
      stackRect.height,
      playerRect.height,
      visibleControlOffset(),
    )
    applyPosition(stackEl, currentPosition, currentControlOffset())
    event.preventDefault()
    event.stopPropagation()
  }
  const finish = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId) return
    dragging = false
    handle.classList.remove('gl-dragging')
    handle.releasePointerCapture?.(pointerId)
    const settings = loadSettings()
    saveSettings({
      ...settings,
      style: { ...settings.style, position: { ...currentPosition } },
    })
    event.preventDefault()
    event.stopPropagation()
  }
  handle.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', finish, true)
  window.addEventListener('pointercancel', finish, true)
  dragCleanup = () => {
    handle.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', finish, true)
    window.removeEventListener('pointercancel', finish, true)
  }
}

/** Convert an absolute dragged top edge to the nearest persisted anchor. */
export function positionFromTop(
  rawTop: number,
  stackHeight: number,
  playerHeight: number,
  controlOffset: number,
): SubtitlePosition {
  if (playerHeight <= 0) return { anchor: 'bottom', percent: 0 }
  const top = Math.min(Math.max(0, playerHeight - stackHeight), Math.max(0, rawTop))
  const center = top + stackHeight / 2
  return center < playerHeight / 2
    ? { anchor: 'top', percent: top / playerHeight * 100 }
    : {
        anchor: 'bottom',
        percent: Math.max(
          0,
          (playerHeight - top - stackHeight - Math.max(0, controlOffset)) / playerHeight * 100,
        ),
      }
}

export function setNativeCaptionsHidden(hidden: boolean): void {
  document.querySelector<HTMLElement>('#movie_player')?.classList.toggle(ACTIVE_CLASS, hidden)
}

export function destroyOverlay(): void {
  classObserver?.disconnect()
  resizeObserver?.disconnect()
  dragCleanup?.()
  classObserver = null
  resizeObserver = null
  dragCleanup = null
  container?.remove()
  stylesEl?.remove()
  document.getElementById(CONTAINER_ID)?.remove()
  document.getElementById(CSS_ID)?.remove()
  setNativeCaptionsHidden(false)
  container = null
  stackEl = null
  originalEl = null
  translatedEl = null
  stylesEl = null
  previewMode = false
  currentDisplayMode = 'bilingual'
  currentPosition = { anchor: 'bottom', percent: 10 }
  lastUpdate = { original: '' }
}
