import { openStylePanel } from './style-panel'

/**
 * "Aa" button to open the subtitle style panel, placed where users look for
 * caption settings. Primary: injected into the player's right-controls bar.
 * Fallback: a floating button on the player corner when the control bar isn't
 * found. Idempotent + re-injectable (the caller polls, so it survives YouTube
 * rebuilding its controls on navigation). Fully self-styled — does not rely on
 * YouTube's `.ytp-button` class (whose styles can hide text).
 */

const BTN_ID = 'gistlate-style-btn'
const FAB_ID = 'gistlate-style-fab'
const TOGGLE_ID = 'gistlate-toggle-btn'
const TOGGLE_FAB_ID = 'gistlate-toggle-fab'
const TRANSCRIPT_ID = 'gistlate-transcript-btn'
const TRANSCRIPT_FAB_ID = 'gistlate-transcript-fab'
const CSS_ID = 'gistlate-style-btn-css'

const CSS = `
  #${BTN_ID}, #${TOGGLE_ID}, #${TRANSCRIPT_ID} {
    display: inline-flex; align-items: center; justify-content: center;
    width: 46px; height: 100%; vertical-align: top; box-sizing: border-box;
    background: transparent; border: none; cursor: pointer;
    font-size: 19px; font-weight: 700; color: #fff; opacity: .85;
  }
  #${BTN_ID}:hover { opacity: 1; }
  #${TOGGLE_ID}:hover { opacity: 1; }
  #${TRANSCRIPT_ID}:hover { opacity: 1; }
  #${TOGGLE_ID}[aria-pressed="true"] { color: #6cb6ff; opacity: 1; }

  #${FAB_ID}, #${TOGGLE_FAB_ID}, #${TRANSCRIPT_FAB_ID} {
    position: absolute; top: 12px; right: 12px; z-index: 60;
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(0,0,0,.65); color: #fff; border: 1px solid rgba(255,255,255,.35);
    cursor: pointer; font-size: 16px; font-weight: 700; line-height: 34px;
    text-align: center; opacity: .85; transition: opacity .15s;
  }
  #${FAB_ID}:hover { opacity: 1; background: rgba(0,0,0,.85); }
  #${TOGGLE_FAB_ID} { right: 54px; }
  #${TRANSCRIPT_FAB_ID} { right: 96px; }
  #${TOGGLE_FAB_ID}:hover { opacity: 1; background: rgba(0,0,0,.85); }
  #${TOGGLE_FAB_ID}[aria-pressed="true"] { color: #6cb6ff; opacity: 1; }
  #${TRANSCRIPT_FAB_ID}:hover { opacity: 1; background: rgba(0,0,0,.85); }
`

// Diagnostics: log only when the mount state changes, not every poll tick.
let lastState = ''
function logState(state: string, detail = ''): void {
  if (state === lastState) return
  lastState = state
  console.log(`[Gistlate] style button: ${state}${detail ? ' — ' + detail : ''}`)
}

function injectCss(): void {
  if (document.getElementById(CSS_ID)) return
  const s = document.createElement('style')
  s.id = CSS_ID
  s.textContent = CSS
  document.head.appendChild(s)
}

function makeButton(id: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.id = id
  btn.type = 'button'
  btn.title = 'Gistlate 字幕样式'
  btn.textContent = 'Aa'
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    openStylePanel()
  })
  return btn
}

function makeToggleButton(
  id: string,
  active: boolean,
  onToggle?: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.id = id
  btn.type = 'button'
  btn.textContent = 'GL'
  updateToggleButton(btn, active)
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    onToggle?.()
  })
  return btn
}

function updateToggleButton(button: HTMLButtonElement, active: boolean): void {
  button.setAttribute('aria-pressed', String(active))
  button.title = active ? '关闭当前视频的 Gistlate 字幕' : '启动当前视频的 Gistlate 字幕'
}

function makeTranscriptButton(id: string, onBrowse?: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  button.type = 'button'
  button.textContent = '文'
  button.title = '打开 Gistlate 字幕浏览器'
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    onBrowse?.()
  })
  return button
}

export interface PlayerButtonOptions {
  active?: boolean
  onToggle?: () => void
  onBrowse?: () => void
}

/**
 * Ensure the style button is mounted. Prefers the native control bar; falls back
 * to a floating corner button. Safe to call repeatedly (e.g. from a poll).
 */
export function mountStyleButton(options: PlayerButtonOptions = {}): void {
  injectCss()
  const active = options.active ?? false
  for (const id of [TOGGLE_ID, TOGGLE_FAB_ID]) {
    const existing = document.getElementById(id)
    if (existing instanceof HTMLButtonElement) updateToggleButton(existing, active)
  }

  const controls = document.querySelector('.ytp-right-controls')
  if (controls) {
    if (document.getElementById(BTN_ID) && document.getElementById(TOGGLE_ID) &&
        document.getElementById(TRANSCRIPT_ID)) {
      logState('mounted-controlbar')
      return
    }
    document.getElementById(BTN_ID)?.remove()
    document.getElementById(TOGGLE_ID)?.remove()
    document.getElementById(TRANSCRIPT_ID)?.remove()
    try {
      const btn = makeButton(BTN_ID)
      const toggle = makeToggleButton(TOGGLE_ID, active, options.onToggle)
      const transcript = makeTranscriptButton(TRANSCRIPT_ID, options.onBrowse)
      const settingsBtn = controls.querySelector('.ytp-settings-button')
      // Insert relative to the settings button *within its own parent* — it is
      // not always a direct child of `.ytp-right-controls`, and insertBefore
      // requires the reference node to be a direct child or it throws.
      if (settingsBtn && settingsBtn.parentElement) {
        settingsBtn.parentElement.insertBefore(toggle, settingsBtn)
        settingsBtn.parentElement.insertBefore(transcript, settingsBtn)
        settingsBtn.parentElement.insertBefore(btn, settingsBtn)
      } else {
        controls.insertBefore(toggle, controls.firstChild)
        controls.insertBefore(transcript, controls.firstChild)
        controls.insertBefore(btn, controls.firstChild)
      }
      document.getElementById(FAB_ID)?.remove() // prefer the native slot
      document.getElementById(TOGGLE_FAB_ID)?.remove()
      document.getElementById(TRANSCRIPT_FAB_ID)?.remove()
      logState('mounted-controlbar', 'injected near settings')
      return
    } catch (e) {
      // Never let a DOM surprise throw every poll tick — fall back to the FAB.
      logState('controlbar-failed', String(e))
    }
  }

  // Fallback: floating button on the player
  const player = document.querySelector('#movie_player')
  if (player) {
    if (document.getElementById(FAB_ID) && document.getElementById(TOGGLE_FAB_ID) &&
        document.getElementById(TRANSCRIPT_FAB_ID)) {
      logState('mounted-fab')
      return
    }
    document.getElementById(FAB_ID)?.remove()
    document.getElementById(TOGGLE_FAB_ID)?.remove()
    document.getElementById(TRANSCRIPT_FAB_ID)?.remove()
    player.appendChild(makeButton(FAB_ID))
    player.appendChild(makeToggleButton(TOGGLE_FAB_ID, active, options.onToggle))
    player.appendChild(makeTranscriptButton(TRANSCRIPT_FAB_ID, options.onBrowse))
    logState('mounted-fab', 'control bar unavailable, using floating button')
    return
  }

  logState('waiting', 'no .ytp-right-controls and no #movie_player yet')
}
