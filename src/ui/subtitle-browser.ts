import { listL1, type CacheEntry } from '../cache/l1'
import { store } from '../core/store'
import { loadSettings } from '../settings'
import { findCueIndexAt } from '../subtitles/cues'
import type { Cue } from '../subtitles/timedtext'
import {
  filterTranscriptCues,
  formatSrt,
  IncompleteTranslatedSrtError,
  type SrtChannel,
} from '../subtitles/transcript'
import { directionForLanguage } from './overlay'

const PANEL_ID = 'gistlate-subtitle-browser'
const CSS_ID = 'gistlate-subtitle-browser-css'

const CSS = `
  #${PANEL_ID} {
    position: fixed; top: 64px; right: 16px; z-index: 2147483645;
    width: min(430px, calc(100vw - 32px)); height: min(760px, calc(100vh - 80px));
    display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden;
    color: #f5f5f5; background: rgba(20,20,22,.97); border: 1px solid rgba(255,255,255,.16);
    border-radius: 14px; box-shadow: 0 18px 55px rgba(0,0,0,.55);
    font: 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  }
  #${PANEL_ID} * { box-sizing: border-box; }
  #${PANEL_ID} .glb-head { display:flex; align-items:center; gap:10px; padding:12px 14px 8px; }
  #${PANEL_ID} .glb-head h2 { margin:0; flex:1; font-size:17px; font-weight:700; }
  #${PANEL_ID} button, #${PANEL_ID} input { font:inherit; }
  #${PANEL_ID} button { color:inherit; }
  #${PANEL_ID} .glb-close { width:32px; height:32px; border:0; border-radius:8px; background:transparent; cursor:pointer; font-size:22px; }
  #${PANEL_ID} .glb-close:hover { background:rgba(255,255,255,.1); }
  #${PANEL_ID} .glb-tabs { display:flex; gap:5px; padding:0 12px 10px; border-bottom:1px solid rgba(255,255,255,.12); }
  #${PANEL_ID} .glb-tab { flex:1; padding:8px 10px; border:0; border-radius:8px; background:rgba(255,255,255,.06); cursor:pointer; }
  #${PANEL_ID} .glb-tab[aria-selected="true"] { background:#2867b2; color:#fff; }
  #${PANEL_ID} .glb-body { min-height:0; flex:1; display:flex; flex-direction:column; padding:12px; gap:10px; }
  #${PANEL_ID} .glb-back { align-self:flex-start; border:0; padding:5px 0; color:#8dc2ff; background:transparent; cursor:pointer; }
  #${PANEL_ID} .glb-meta { padding:10px 11px; border-radius:10px; background:rgba(255,255,255,.055); }
  #${PANEL_ID} .glb-title { margin:0 0 5px; font-size:15px; line-height:1.35; }
  #${PANEL_ID} .glb-identity { color:#b9bcc3; font-size:12px; overflow-wrap:anywhere; }
  #${PANEL_ID} .glb-details { display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:7px; color:#aeb6c3; font-size:11px; }
  #${PANEL_ID} .glb-actions { display:flex; gap:7px; }
  #${PANEL_ID} .glb-action { flex:1; padding:7px 8px; border:1px solid rgba(255,255,255,.18); border-radius:8px; background:rgba(255,255,255,.08); cursor:pointer; }
  #${PANEL_ID} .glb-action:hover:not(:disabled) { background:rgba(255,255,255,.15); }
  #${PANEL_ID} .glb-action:disabled { opacity:.38; cursor:not-allowed; }
  #${PANEL_ID} .glb-search { width:100%; padding:9px 11px; border:1px solid rgba(255,255,255,.18); border-radius:9px; outline:none; color:#fff; background:#111216; }
  #${PANEL_ID} .glb-search:focus { border-color:#6cb6ff; box-shadow:0 0 0 2px rgba(108,182,255,.18); }
  #${PANEL_ID} .glb-notice { min-height:18px; color:#ffcf70; font-size:12px; }
  #${PANEL_ID} .glb-list { min-height:0; flex:1; overflow:auto; display:flex; flex-direction:column; gap:6px; padding-right:3px; }
  #${PANEL_ID} .glb-row { width:100%; display:grid; grid-template-columns:58px minmax(0,1fr); gap:8px; padding:9px; text-align:left; border:1px solid transparent; border-radius:9px; background:rgba(255,255,255,.045); }
  #${PANEL_ID} button.glb-row { cursor:pointer; }
  #${PANEL_ID} button.glb-row:hover { background:rgba(255,255,255,.09); }
  #${PANEL_ID} .glb-row.glb-active { border-color:#68b5ff; background:rgba(40,103,178,.32); }
  #${PANEL_ID} .glb-time { color:#8eb8df; font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
  #${PANEL_ID} .glb-lines { min-width:0; }
  #${PANEL_ID} .glb-original, #${PANEL_ID} .glb-translated { white-space:pre-wrap; overflow-wrap:anywhere; }
  #${PANEL_ID} .glb-original { color:#d7d9dd; }
  #${PANEL_ID} .glb-translated { margin-top:3px; color:#fff; font-weight:600; }
  #${PANEL_ID} .glb-pending { color:#92969e; font-weight:400; font-style:italic; }
  #${PANEL_ID} .glb-empty { margin:auto; padding:24px; text-align:center; color:#a8abb2; }
  #${PANEL_ID} .glb-library-head { display:flex; align-items:center; gap:8px; }
  #${PANEL_ID} .glb-library-head strong { flex:1; }
  #${PANEL_ID} .glb-refresh { border:0; padding:6px 8px; border-radius:7px; background:rgba(255,255,255,.08); cursor:pointer; }
  #${PANEL_ID} .glb-card { width:100%; padding:11px; border:1px solid rgba(255,255,255,.1); border-radius:10px; text-align:left; background:rgba(255,255,255,.045); cursor:pointer; }
  #${PANEL_ID} .glb-card:hover { border-color:rgba(108,182,255,.65); background:rgba(255,255,255,.08); }
  #${PANEL_ID} .glb-card-title { display:block; margin-bottom:5px; font-weight:650; }
  #${PANEL_ID} .glb-card-meta { display:block; color:#aeb3bc; font-size:11px; overflow-wrap:anywhere; }
  @media (max-width: 600px) {
    #${PANEL_ID} { top:56px; right:8px; width:calc(100vw - 16px); height:calc(100vh - 64px); }
  }
`

export interface SubtitleBrowserOptions {
  getCurrentVideoId(): string | null
  getCurrentVideoTitle(): string | undefined
  seekCurrentVideo(timeMs: number): void
}

export interface ArtifactPresentation {
  title: string
  identity: string
  details: string[]
}

interface TranscriptDocument {
  videoId: string
  title: string
  src: string
  tgt: string
  cues: Cue[]
  artifact?: CacheEntry
}

interface DetailElements {
  metadata: HTMLDivElement
  sourceButton: HTMLButtonElement
  translatedButton: HTMLButtonElement
  search: HTMLInputElement
  notice: HTMLDivElement
  list: HTMLDivElement
}

type BrowserView = 'current' | 'library' | 'artifact'

let closeCurrentPanel: (() => void) | undefined

export function openSubtitleBrowser(options: SubtitleBrowserOptions): void {
  const existing = document.getElementById(PANEL_ID)
  if (existing) {
    existing.querySelector<HTMLInputElement>('.glb-search')?.focus()
    return
  }

  injectCss()
  const root = document.createElement('section')
  root.id = PANEL_ID
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Gistlate 字幕浏览器')

  const header = makeDiv('glb-head')
  const heading = document.createElement('h2')
  heading.textContent = 'Gistlate 字幕浏览器'
  const closeButton = makeButton('glb-close', '×')
  closeButton.title = '关闭字幕浏览器'
  header.append(heading, closeButton)

  const tabs = makeDiv('glb-tabs')
  tabs.setAttribute('role', 'tablist')
  const currentTab = makeButton('glb-tab', '当前字幕')
  const libraryTab = makeButton('glb-tab', '本地字幕库')
  currentTab.setAttribute('role', 'tab')
  libraryTab.setAttribute('role', 'tab')
  tabs.append(currentTab, libraryTab)

  const body = makeDiv('glb-body')
  root.append(header, tabs, body)
  document.body.appendChild(root)

  let view: BrowserView = 'current'
  let openedArtifact: CacheEntry | undefined
  let details: DetailElements | undefined
  let query = ''
  let libraryEntries: CacheEntry[] = []
  let libraryLoaded = false
  let libraryLoading = false
  let libraryError = ''
  let lastSubtitle = store.subtitle
  let activeIndex = -1
  const rows = new Map<number, HTMLElement>()

  const currentDocument = (): TranscriptDocument | undefined => {
    const subtitle = store.subtitle
    const videoId = options.getCurrentVideoId()
    if (!subtitle || !videoId) return undefined
    const artifact = subtitle.artifact
    return {
      videoId,
      title: options.getCurrentVideoTitle() || artifact?.video?.title || videoId,
      src: subtitle.srcLang,
      tgt: artifact?.tgt || loadSettings().tgt,
      cues: subtitle.cues,
      artifact,
    }
  }

  const openedDocument = (): TranscriptDocument | undefined => openedArtifact && ({
    videoId: openedArtifact.videoId,
    title: openedArtifact.video?.title || openedArtifact.videoId,
    src: openedArtifact.src,
    tgt: openedArtifact.tgt,
    cues: openedArtifact.cues,
    artifact: openedArtifact,
  })

  const selectedDocument = (): TranscriptDocument | undefined =>
    view === 'current' ? currentDocument() : openedDocument()

  const setTabs = (): void => {
    currentTab.setAttribute('aria-selected', String(view === 'current'))
    libraryTab.setAttribute('aria-selected', String(view !== 'current'))
  }

  const setNotice = (message: string): void => {
    if (details) details.notice.textContent = message
  }

  const download = (channel: SrtChannel): void => {
    const documentState = selectedDocument()
    if (!documentState) return
    try {
      const content = formatSrt(documentState.cues, channel)
      downloadText(content, srtFilename(documentState, channel))
      setNotice(channel === 'translated' ? '译文 SRT 已下载' : '原文 SRT 已下载')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SRT 导出失败'
      setNotice(error instanceof IncompleteTranslatedSrtError
        ? `译文尚未完整，不能导出译文 SRT（缺少第 ${error.cueNumbers.join('、')} 条）`
        : message)
    }
  }

  const updateActiveRow = (timeMs: number): void => {
    const documentState = selectedDocument()
    const seekable = documentState && canSeekArtifact(
      documentState.videoId,
      options.getCurrentVideoId(),
    )
    const nextIndex = seekable ? findCueIndexAt(documentState.cues, timeMs) : -1
    if (nextIndex === activeIndex) return
    rows.get(activeIndex)?.classList.remove('glb-active')
    activeIndex = nextIndex
    const active = rows.get(activeIndex)
    active?.classList.add('glb-active')
    active?.scrollIntoView({ block: 'nearest' })
  }

  const refreshDetail = (): void => {
    if (!details) return
    const documentState = selectedDocument()
    rows.clear()
    activeIndex = -1
    details.metadata.replaceChildren()
    details.list.replaceChildren()
    details.notice.textContent = ''

    if (!documentState) {
      renderEmpty(details.list, '当前没有字幕。请先启动 Gistlate，或从本地字幕库打开一个 artifact。')
      details.sourceButton.disabled = true
      details.translatedButton.disabled = true
      return
    }

    renderMetadata(details.metadata, documentState)
    details.sourceButton.disabled = documentState.cues.length === 0
    details.translatedButton.disabled = documentState.cues.length === 0
    const filtered = filterTranscriptCues(documentState.cues, query)
    if (filtered.length === 0) {
      renderEmpty(details.list, query ? '没有匹配的字幕' : '这个 artifact 没有字幕 cue')
      return
    }

    const seekable = canSeekArtifact(documentState.videoId, options.getCurrentVideoId())
    for (const { cue, index } of filtered) {
      const row = renderCueRow(cue, index, documentState, seekable, () => {
        options.seekCurrentVideo(cue.s)
      })
      rows.set(index, row)
      details.list.appendChild(row)
    }
    updateActiveRow(store.currentTime)
  }

  const showDetail = (nextView: 'current' | 'artifact'): void => {
    view = nextView
    query = ''
    details = undefined
    setTabs()
    body.replaceChildren()
    if (view === 'artifact') {
      const back = makeButton('glb-back', '← 返回本地字幕库')
      back.addEventListener('click', () => showLibrary())
      body.appendChild(back)
    }

    const metadata = makeDiv('glb-meta')
    const actions = makeDiv('glb-actions')
    const sourceButton = makeButton('glb-action', '下载原文 SRT')
    const translatedButton = makeButton('glb-action', '下载译文 SRT')
    actions.append(sourceButton, translatedButton)
    const search = document.createElement('input')
    search.className = 'glb-search'
    search.type = 'search'
    search.placeholder = '搜索原文或译文'
    search.setAttribute('aria-label', '搜索字幕')
    const notice = makeDiv('glb-notice')
    notice.setAttribute('role', 'status')
    const list = makeDiv('glb-list')
    body.append(metadata, actions, search, notice, list)
    details = { metadata, sourceButton, translatedButton, search, notice, list }

    sourceButton.addEventListener('click', () => download('original'))
    translatedButton.addEventListener('click', () => download('translated'))
    search.addEventListener('input', () => {
      query = search.value
      refreshDetail()
      search.focus()
    })
    refreshDetail()
  }

  const renderLibrary = (): void => {
    view = 'library'
    openedArtifact = undefined
    details = undefined
    setTabs()
    body.replaceChildren()
    const libraryHead = makeDiv('glb-library-head')
    const title = document.createElement('strong')
    title.textContent = '本地 L1 字幕'
    const refresh = makeButton('glb-refresh', '刷新')
    refresh.addEventListener('click', () => void loadLibrary(true))
    libraryHead.append(title, refresh)
    const list = makeDiv('glb-list')
    body.append(libraryHead, list)

    if (libraryLoading) {
      renderEmpty(list, '正在读取本地字幕库…')
      return
    }
    if (libraryError) {
      renderEmpty(list, libraryError)
      return
    }
    if (!libraryLoaded) {
      renderEmpty(list, '正在读取本地字幕库…')
      void loadLibrary()
      return
    }
    if (libraryEntries.length === 0) {
      renderEmpty(list, '本地还没有已完成的字幕 artifact')
      return
    }
    for (const entry of libraryEntries) {
      const card = makeButton('glb-card', '')
      const name = document.createElement('span')
      name.className = 'glb-card-title'
      name.textContent = entry.video?.title || entry.videoId
      const meta = document.createElement('span')
      meta.className = 'glb-card-meta'
      const cost = entry.generation?.costCny
      meta.textContent = `${entry.src} → ${entry.tgt} · ${entry.cues.length} 条 · ` +
        `${formatDate(entry.createdAt)}${typeof cost === 'number' ? ` · ¥${formatCost(cost)}` : ''}`
      card.append(name, meta)
      card.addEventListener('click', () => {
        openedArtifact = entry
        showDetail('artifact')
      })
      list.appendChild(card)
    }
  }

  const loadLibrary = async (force = false): Promise<void> => {
    if (libraryLoading || libraryLoaded && !force) return
    libraryLoading = true
    libraryError = ''
    if (view === 'library') renderLibrary()
    try {
      libraryEntries = await listL1()
      libraryLoaded = true
    } catch (error) {
      libraryError = error instanceof Error
        ? `无法读取本地字幕库：${error.message}`
        : '无法读取本地字幕库'
    } finally {
      libraryLoading = false
      if (root.isConnected && view === 'library') renderLibrary()
    }
  }

  const showLibrary = (): void => renderLibrary()

  currentTab.addEventListener('click', () => showDetail('current'))
  libraryTab.addEventListener('click', showLibrary)

  const unsubscribe = store.subscribe((timeMs) => {
    const subtitleChanged = lastSubtitle !== store.subtitle ||
      lastSubtitle?.cues !== store.subtitle?.cues ||
      lastSubtitle?.artifact !== store.subtitle?.artifact
    if (subtitleChanged) {
      // A force retranslation replaces the artifact at the same cache key, so
      // identity—not only key equality—must invalidate an already-loaded list.
      const artifactChanged = lastSubtitle?.artifact !== store.subtitle?.artifact
      lastSubtitle = store.subtitle
      if (artifactChanged) libraryLoaded = false
      if (view === 'current') refreshDetail()
    }
    if (view === 'current' || view === 'artifact') updateActiveRow(timeMs)
  })

  const close = (): void => {
    unsubscribe()
    root.remove()
    document.getElementById(CSS_ID)?.remove()
    if (closeCurrentPanel === close) closeCurrentPanel = undefined
  }
  closeCurrentPanel = close
  closeButton.addEventListener('click', close)
  showDetail('current')
}

export function destroySubtitleBrowser(): void {
  closeCurrentPanel?.()
}

export function canSeekArtifact(artifactVideoId: string, currentVideoId: string | null): boolean {
  return Boolean(currentVideoId && artifactVideoId === currentVideoId)
}

export function describeArtifact(entry: CacheEntry): ArtifactPresentation {
  const details = [entry.model, formatDate(entry.createdAt)]
  const strategy = entry.generation?.strategy
  if (strategy) {
    const modes = { sentence: '逐句', batch: '分批', whole: '全量' } as const
    details.push(
      `${modes[strategy.mode]} · 翻译请求 ${strategy.effectiveRequestCount} · ` +
      `边界 ${strategy.boundaryMethod}`,
    )
  }
  const usage = entry.generation?.usage
  if (usage) {
    const tokens = usage.tokens
    details.push(
      `请求 ${usage.requestCount}` +
      tokenPart('命中', tokens.promptCacheHitTokens) +
      tokenPart('未命中', tokens.promptCacheMissTokens) +
      tokenPart('输出', tokens.completionTokens),
    )
  }
  if (typeof entry.generation?.costCny === 'number') {
    details.push(`实际费用 ¥${formatCost(entry.generation.costCny)} CNY`)
  }
  return {
    title: entry.video?.title || entry.videoId,
    identity: `${entry.videoId} · ${entry.src} → ${entry.tgt} · ${entry.cues.length} 条`,
    details,
  }
}

function renderMetadata(container: HTMLDivElement, documentState: TranscriptDocument): void {
  const presentation = documentState.artifact
    ? describeArtifact(documentState.artifact)
    : {
        title: documentState.title,
        identity: `${documentState.videoId} · ${documentState.src} → ${documentState.tgt} · ` +
          `${documentState.cues.length} 条`,
        details: ['实时字幕（完整 artifact 生成后显示费用与策略）'],
      }
  const title = document.createElement('h3')
  title.className = 'glb-title'
  title.textContent = documentState.title || presentation.title
  const identity = makeDiv('glb-identity', presentation.identity)
  const details = makeDiv('glb-details')
  for (const value of presentation.details) {
    const item = document.createElement('span')
    item.textContent = value
    details.appendChild(item)
  }
  container.append(title, identity, details)
}

function renderCueRow(
  cue: Cue,
  index: number,
  documentState: TranscriptDocument,
  seekable: boolean,
  onSeek: () => void,
): HTMLElement {
  const row = seekable ? document.createElement('button') : document.createElement('div')
  row.className = 'glb-row'
  if (row instanceof HTMLButtonElement) {
    row.type = 'button'
    row.title = `跳转到 ${formatClock(cue.s)}`
    row.addEventListener('click', onSeek)
  }
  const time = makeDiv('glb-time', formatClock(cue.s))
  const lines = makeDiv('glb-lines')
  const original = makeDiv('glb-original', cue.o)
  original.lang = documentState.src
  original.dir = directionForLanguage(documentState.src)
  const translated = makeDiv('glb-translated', cue.t || '等待译文…')
  translated.lang = documentState.tgt
  translated.dir = directionForLanguage(documentState.tgt)
  if (!cue.t) translated.classList.add('glb-pending')
  lines.append(original, translated)
  row.append(time, lines)
  row.dataset.cueIndex = String(index)
  return row
}

function renderEmpty(container: HTMLElement, message: string): void {
  container.replaceChildren(makeDiv('glb-empty', message))
}

function injectCss(): void {
  if (document.getElementById(CSS_ID)) return
  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function makeDiv(className: string, text = ''): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  element.textContent = text
  return element
}

function makeButton(className: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  return button
}

function formatClock(timeMs: number): string {
  const seconds = Math.max(0, Math.floor(timeMs / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function formatDate(value: number): string {
  return Number.isFinite(value) ? new Date(value).toLocaleString() : '时间未知'
}

function formatCost(value: number): string {
  return value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '') || '0'
}

function tokenPart(label: string, value?: number): string {
  return value === undefined ? '' : ` · ${label} ${value.toLocaleString()}`
}

function srtFilename(documentState: TranscriptDocument, channel: SrtChannel): string {
  const base = `${documentState.videoId}.${documentState.src}-${documentState.tgt}.${channel}`
  return `${base.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')}.srt`
}

function downloadText(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-subrip;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
