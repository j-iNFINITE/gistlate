/**
 * Minimal on-screen translation status pill (not a streaming progress bar).
 * Shows a spinner + "翻译中…" while a fresh whole-video translation runs, a brief
 * "✓ 翻译完成" on success, and "翻译失败" on error. Cache hits show nothing.
 * Mounted on `#movie_player`, non-interactive, auto-hiding for terminal states.
 */

const ID = 'gistlate-status'
const CSS_ID = 'gistlate-status-css'

const CSS = `
  #${ID} {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 59; pointer-events: none;
    display: inline-flex; align-items: center; gap: 7px;
    max-width: 80%; box-sizing: border-box;
    background: rgba(0,0,0,.72); color: #fff; border-radius: 14px;
    padding: 5px 12px; font-size: 13px; line-height: 1.3;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    opacity: 0; transition: opacity .2s;
  }
  #${ID}.gl-show { opacity: 1; }
  #${ID} .gl-spin {
    width: 12px; height: 12px; flex: none;
    border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
    border-radius: 50%; animation: gl-status-spin .8s linear infinite;
  }
  @keyframes gl-status-spin { to { transform: rotate(360deg); } }
`

let hideTimer: ReturnType<typeof setTimeout> | undefined

function injectCss(): void {
  if (document.getElementById(CSS_ID)) return
  const s = document.createElement('style')
  s.id = CSS_ID
  s.textContent = CSS
  document.head.appendChild(s)
}

function ensureEl(): HTMLDivElement | null {
  const player = document.querySelector('#movie_player')
  if (!player) return null
  injectCss()
  let el = document.getElementById(ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = ID
    player.appendChild(el)
  }
  return el
}

/** Render `text`, optionally with a leading spinner. */
function render(text: string, spinner: boolean): HTMLDivElement | null {
  const el = ensureEl()
  if (!el) return null
  clearTimeout(hideTimer)
  el.textContent = ''
  if (spinner) el.appendChild(Object.assign(document.createElement('span'), { className: 'gl-spin' }))
  el.appendChild(document.createTextNode(text))
  el.classList.add('gl-show')
  return el
}

export function showTranslating(): void {
  render('Gistlate 翻译中…', true)
}

export function showDone(): void {
  render('✓ 翻译完成', false)
  autoHide(1500)
}

export function showError(): void {
  render('翻译失败', false)
  autoHide(3000)
}

export function hideStatus(): void {
  const el = document.getElementById(ID)
  el?.classList.remove('gl-show')
}

/** Remove the pill entirely (e.g. on SPA navigation). */
export function destroyStatus(): void {
  clearTimeout(hideTimer)
  document.getElementById(ID)?.remove()
}

function autoHide(ms: number): void {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hideStatus, ms)
}
