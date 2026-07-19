import type { TranslationMode } from '../settings'
import type { CaptionScale, RequestRisk } from '../core/long-video-guard'

const ROOT_ID = 'gistlate-translation-guard'
const CSS_ID = 'gistlate-translation-guard-css'

const CSS = `
  #${ROOT_ID} {
    position: fixed; inset: 0; z-index: 1000000;
    display: flex; align-items: center; justify-content: center;
    box-sizing: border-box; padding: 20px;
    background: rgba(0,0,0,.72); color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  #${ROOT_ID} .glg-modal {
    width: min(520px, 100%); max-height: min(720px, 90vh); overflow: auto;
    box-sizing: border-box; padding: 22px; border: 1px solid #444;
    border-radius: 12px; background: #202124; box-shadow: 0 12px 42px rgba(0,0,0,.55);
  }
  #${ROOT_ID} h2 { margin: 0 0 10px; font-size: 20px; color: #fff; }
  #${ROOT_ID} .glg-copy { margin: 0 0 14px; color: #bbb; line-height: 1.55; }
  #${ROOT_ID} .glg-title {
    margin: 0 0 14px; color: #fff; font-weight: 600; line-height: 1.45;
    overflow-wrap: anywhere;
  }
  #${ROOT_ID} dl {
    display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px;
    margin: 14px 0; padding: 12px; border-radius: 8px; background: #292a2d;
  }
  #${ROOT_ID} dt { color: #999; }
  #${ROOT_ID} dd { margin: 0; color: #eee; overflow-wrap: anywhere; }
  #${ROOT_ID} .glg-risk-high { color: #ff8a80; font-weight: 700; }
  #${ROOT_ID} .glg-risk-medium { color: #ffd180; font-weight: 700; }
  #${ROOT_ID} .glg-risk-low { color: #b9f6ca; font-weight: 700; }
  #${ROOT_ID} .glg-warning {
    margin: 14px 0 0; padding: 10px 12px; border-left: 3px solid #f9ab00;
    background: rgba(249,171,0,.09); color: #ddd; line-height: 1.5;
  }
  #${ROOT_ID} .glg-actions {
    display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 20px;
  }
  #${ROOT_ID} button {
    border: 0; border-radius: 5px; padding: 9px 14px; cursor: pointer;
    font: inherit; font-weight: 600;
  }
  #${ROOT_ID} .glg-cancel { background: #444; color: #fff; }
  #${ROOT_ID} .glg-settings { background: transparent; color: #8ab4f8; border: 1px solid #5f6368; }
  #${ROOT_ID} .glg-continue { background: #d93025; color: #fff; }
  #${ROOT_ID} button:hover { filter: brightness(1.12); }
  #${ROOT_ID} button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
`

export type TranslationGuardDialogDecision = 'cancel' | 'settings' | 'continue'

export interface TranslationGuardDialogDetails {
  title?: string
  scale: CaptionScale
  mode: TranslationMode
  batchSize: number
  risk: RequestRisk
  force: boolean
  signal?: AbortSignal
}

let activePromise: Promise<TranslationGuardDialogDecision> | null = null
let settleActive: ((decision: TranslationGuardDialogDecision) => void) | null = null

export function openLongVideoConfirmation(
  details: TranslationGuardDialogDetails,
): Promise<TranslationGuardDialogDecision> {
  return openDialog(details, false)
}

export function openCurrentLiveNotice(
  details: TranslationGuardDialogDetails,
): Promise<TranslationGuardDialogDecision> {
  return openDialog(details, true)
}

export function destroyTranslationGuardDialog(): void {
  settleActive?.('cancel')
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '未知'
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds % 3600 / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0 || hours > 0) parts.push(`${minutes} 分钟`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} 秒`)
  return parts.join(' ')
}

export function translationModeLabel(mode: TranslationMode, batchSize: number): string {
  if (mode === 'sentence') return '一句一次'
  if (mode === 'whole') return '全量一次'
  return `每批 ${batchSize} 句`
}

function openDialog(
  details: TranslationGuardDialogDetails,
  live: boolean,
): Promise<TranslationGuardDialogDecision> {
  if (activePromise) return activePromise
  if (details.signal?.aborted) return Promise.resolve('cancel')

  injectCss()
  const root = element('div', { id: ROOT_ID })
  const modal = element('section', { className: 'glg-modal' })
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', `${ROOT_ID}-title`)
  modal.appendChild(element('h2', {
    id: `${ROOT_ID}-title`,
    textContent: live ? '当前直播暂不支持完整翻译' : '确认翻译整个长视频',
  }))
  modal.appendChild(element('p', {
    className: 'glg-copy',
    textContent: live
      ? '直播字幕仍在增长。请等待直播结束并成为有限回放后，再重新点击 GL。'
      : details.force
        ? '这次操作会忽略现有缓存，并用当前模式重新翻译整个视频。'
        : '自动翻译已因字幕跨度超过限制而暂停。继续会翻译整个视频。',
  }))
  if (details.title) {
    modal.appendChild(element('p', { className: 'glg-title', textContent: details.title }))
  }

  const facts = element('dl')
  appendFact(facts, '字幕跨度', formatDuration(details.scale.spanMs ?? details.scale.playerDurationMs))
  appendFact(facts, '字幕数量', `${details.scale.cueCount.toLocaleString()} 条`)
  appendFact(facts, '原文字符', `${details.scale.sourceCodePoints.toLocaleString()} 个`)
  appendFact(facts, '当前模式', translationModeLabel(details.mode, details.batchSize))
  const riskValue = element('span', {
    className: `glg-risk-${details.risk}`,
    textContent: riskLabel(details.risk),
  })
  appendFact(facts, '请求风险', riskValue)
  modal.appendChild(facts)

  modal.appendChild(element('p', {
    className: 'glg-copy',
    textContent: '风险等级只描述当前模式与字幕规模。断句、对齐和重试会影响实际请求；最终费用以模型返回的 usage 为准。',
  }))
  if (!live) {
    modal.appendChild(element('p', {
      className: 'glg-warning',
      textContent: '关闭页面只能中止尚未完成的工作；已经由模型返回的请求仍可能计费。',
    }))
  }

  const actions = element('div', { className: 'glg-actions' })
  const cancel = element('button', {
    className: 'glg-cancel',
    type: 'button',
    textContent: live ? '知道了' : '取消',
  })
  actions.appendChild(cancel)
  let settingsButton: HTMLButtonElement | undefined
  let continueButton: HTMLButtonElement | undefined
  if (!live) {
    settingsButton = element('button', {
      className: 'glg-settings',
      type: 'button',
      textContent: '打开翻译设置',
    })
    continueButton = element('button', {
      className: 'glg-continue',
      type: 'button',
      textContent: '按当前模式翻译整个视频',
    })
    actions.append(settingsButton, continueButton)
  }
  modal.appendChild(actions)
  root.appendChild(modal)
  document.body.appendChild(root)

  activePromise = new Promise<TranslationGuardDialogDecision>((resolve) => {
    let settled = false
    const abort = () => settle('cancel')
    const settle = (decision: TranslationGuardDialogDecision) => {
      if (settled) return
      settled = true
      details.signal?.removeEventListener('abort', abort)
      root.removeEventListener('keydown', onKeyDown)
      root.remove()
      document.getElementById(CSS_ID)?.remove()
      settleActive = null
      activePromise = null
      resolve(decision)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        settle('cancel')
      } else if (event.key === 'Enter') {
        // Expensive continuation always requires an explicit button click.
        event.preventDefault()
      }
    }
    settleActive = settle
    cancel.addEventListener('click', () => settle('cancel'))
    settingsButton?.addEventListener('click', () => settle('settings'))
    continueButton?.addEventListener('click', () => settle('continue'))
    root.addEventListener('click', (event) => {
      if (event.target === root) settle('cancel')
    })
    root.addEventListener('keydown', onKeyDown)
    details.signal?.addEventListener('abort', abort, { once: true })
    queueMicrotask(() => cancel.focus())
  })
  return activePromise
}

function injectCss(): void {
  if (document.getElementById(CSS_ID)) return
  document.head.appendChild(element('style', { id: CSS_ID, textContent: CSS }))
}

function appendFact(list: HTMLDListElement, label: string, value: string | Node): void {
  list.appendChild(element('dt', { textContent: label }))
  const definition = element('dd')
  if (typeof value === 'string') definition.textContent = value
  else definition.appendChild(value)
  list.appendChild(definition)
}

function riskLabel(risk: RequestRisk): string {
  return risk === 'high' ? '高' : risk === 'medium' ? '中' : '低'
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  return node
}
