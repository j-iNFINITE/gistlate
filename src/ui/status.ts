import type { TranslationProgress } from '../translate/pipeline'

const ID = 'gistlate-status'
const CSS_ID = 'gistlate-status-css'
const GUARD_NOTICE_MS = 8_000

const CSS = `
  #${ID} {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 59; pointer-events: none;
    display: inline-flex; align-items: center; gap: 7px;
    max-width: 80%; box-sizing: border-box;
    background: rgba(0,0,0,.72); color: #fff; border-radius: 14px;
    padding: 5px 12px; font-size: 13px; line-height: 1.3;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    white-space: pre-line; text-align: center;
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
  render('Gistlate 正在翻译字幕…', true)
}

export function showWaitingPlayer(): void {
  render('Gistlate 正在等待字幕轨道…', true)
}

export function showFetchingSubtitles(): void {
  render('Gistlate 正在获取字幕…', true)
}

export function showWaitingPot(): void {
  render('Gistlate 正在等待 YouTube 字幕授权…', true)
}

export function showDirectReady(): void {
  render('✓ 已使用现成目标语言字幕', false)
  autoHide(1800)
}

export function showProgress(progress: TranslationProgress): void {
  if (progress.stage === 'boundaries') {
    render('Gistlate 正在分析字幕结构…', true)
    return
  }
  const verb = progress.stage === 'aligning' ? '正在对齐' : '已翻译'
  render(`Gistlate ${verb} ${progress.completedSentences} / ${progress.totalSentences}`, true)
}

export function showDone(): void {
  render('✓ 翻译完成', false)
  autoHide(1500)
}

export function showError(): void {
  render('翻译失败', false)
  autoHide(3000)
}

export function showAcquisitionError(message = '未能获取字幕'): void {
  render(message, false)
  autoHide(3500)
}

export function showLongVideoGuarded(span: string): void {
  render(`字幕跨度 ${span}，已跳过自动翻译\n点击 GL 可手动翻译整个视频`, false)
  autoHide(GUARD_NOTICE_MS)
}

export function showLiveGuarded(): void {
  render('当前视频仍在直播，已跳过完整翻译\n请在直播结束后重试', false)
  autoHide(GUARD_NOTICE_MS)
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
