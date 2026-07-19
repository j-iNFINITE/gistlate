/// <reference types="vite-plugin-monkey/client" />
import { GM_registerMenuCommand } from '$'
import { loadSettings } from './settings'
import { clearObservedTimedtext, interceptTimedtext } from './intercept/netHook'
import {
  acquireCurrentSubtitles,
  type AcquisitionStage,
  type AcquiredSubtitles,
} from './subtitles/acquire'
import { parseTimedtext, type Cue } from './subtitles/timedtext'
import { cleanCues } from './subtitles/clean'
import { findCueAt } from './subtitles/cues'
import { normalizeLang } from './translate/lang'
import {
  captionTrackNeedsTranslation,
  type SelectedCaptionTrack,
} from './subtitles/tracks'
import {
  getVideoId,
  getVideoContext,
  onVideoChange,
  getVideoElement,
  getPlaybackFacts,
} from './youtube'
import { store } from './core/store'
import {
  resolveTranslation,
  type TranslationPreflightDecision,
} from './core/resolve'
import { deactivatedVideoId, shouldAutoStartVideo } from './core/activation'
import {
  classifyRequestRisk,
  evaluateLongVideoGuard,
  measureCaptionScale,
  selectTranslationPreflightAction,
  shouldRestoreGuardAfterFailure,
  type CaptionScale,
  type LongVideoGuardEvaluation,
  type LongVideoGuardReason,
  type TranslationActivationIntent,
} from './core/long-video-guard'
import { createOverlay, destroyOverlay, type Overlay } from './ui/overlay'
import { openSettingsPanel } from './ui/settings-panel'
import { openStylePanel } from './ui/style-panel'
import { mountStyleButton } from './ui/style-button'
import { openSubtitleBrowser } from './ui/subtitle-browser'
import {
  showWaitingPlayer,
  showFetchingSubtitles,
  showWaitingPot,
  showDirectReady,
  showTranslating,
  showProgress,
  showDone,
  showError,
  showAcquisitionError,
  showLongVideoGuarded,
  showLiveGuarded,
  hideStatus,
  destroyStatus,
} from './ui/status'
import {
  destroyTranslationGuardDialog,
  formatDuration,
  openCurrentLiveNotice,
  openLongVideoConfirmation,
} from './ui/translation-guard-dialog'
import { reconcileStaleUsageOperations } from './usage/ledger'

console.log('[Gistlate] Script loaded on YouTube')

void reconcileStaleUsageOperations().catch((error) => {
  console.warn('[Gistlate] Could not reconcile stale usage operations', error)
})

const initialSettings = loadSettings()
console.log('[Gistlate] Settings loaded:', {
  tgt: initialSettings.tgt,
  displayMode: initialSettings.displayMode,
  autoStart: initialSettings.autoStart,
  openai: `baseUrl=${initialSettings.openai.baseUrl} model=${initialSettings.openai.model}`,
  github: `owner=${initialSettings.github.owner} repo=${initialSettings.github.repo}`,
})

GM_registerMenuCommand('Gistlate 设置', openSettingsPanel)
GM_registerMenuCommand('Gistlate 字幕样式', openStylePanel)
GM_registerMenuCommand('Gistlate 重新翻译当前视频', retranslateCurrentVideo)
GM_registerMenuCommand('Gistlate 字幕浏览器', openSubtitleBrowserForPage)

// Install the observe-only network hook immediately. It stages URLs/POT/JSON3
// even when auto-start is off, but never starts translation by itself.
interceptTimedtext(() => {})

interface CurrentTrack {
  videoId: string
  srcLang: string
  fragments: Cue[]
  selected: SelectedCaptionTrack
  directTarget: boolean
}

interface GuardedVideoState {
  videoId: string
  reason: LongVideoGuardReason
  scale: CaptionScale
}

type GuardedEvaluation = Extract<LongVideoGuardEvaluation, { action: 'guard' }>

interface PreflightOutcome {
  decision: TranslationPreflightDecision
  guard?: GuardedEvaluation
}

let overlay: Overlay | null = null
let currentTrack: CurrentTrack | null = null
let activeVideoId: string | null = null
let suppressedVideoId: string | null = null
let guardedVideo: GuardedVideoState | null = null
let translatingVideoId: string | null = null
let lastCueKey = ''
let pageVideoId = getVideoId()

function updateOverlay(timeMs: number): void {
  if (!store.subtitle || !activeVideoId) return
  if (!overlay) {
    overlay = createOverlay()
    overlay?.setActive(true)
    overlay?.setDisplayMode(loadSettings().displayMode)
    if (!overlay) return
  }

  const cue = findCueAt(store.subtitle.cues, timeMs)
  const key = cue ? `${cue.s}|${cue.o}|${cue.t ?? ''}|${currentTrack?.directTarget ?? false}` : ''
  if (key === lastCueKey) return
  lastCueKey = key

  if (!cue) {
    overlay.update('')
    return
  }
  const track = currentTrack
  overlay.update(cue.o, cue.t, {
    sourceLang: track?.srcLang,
    targetLang: loadSettings().tgt,
    directTarget: track?.directTarget,
  })
}

store.subscribe(updateOverlay)

let videoEl: HTMLVideoElement | null = null
let timeHandler: (() => void) | null = null
let seekHandler: (() => void) | null = null

function attachTimeListener(): void {
  const video = getVideoElement()
  if (!video || video === videoEl) return
  detachTimeListener()
  videoEl = video
  timeHandler = () => store.setCurrentTime(video.currentTime * 1000)
  seekHandler = () => {
    lastCueKey = ''
    store.setCurrentTime(video.currentTime * 1000)
  }
  video.addEventListener('timeupdate', timeHandler)
  video.addEventListener('seeked', seekHandler)
}

function detachTimeListener(): void {
  if (videoEl && timeHandler) videoEl.removeEventListener('timeupdate', timeHandler)
  if (videoEl && seekHandler) videoEl.removeEventListener('seeked', seekHandler)
  videoEl = null
  timeHandler = null
  seekHandler = null
}

const pollInterval = setInterval(() => {
  attachTimeListener()
  if (activeVideoId) {
    const mountedOverlay = createOverlay()
    if (mountedOverlay) {
      overlay = mountedOverlay
      overlay.setActive(true)
      overlay.setDisplayMode(loadSettings().displayMode)
    }
  }
  mountStyleButton({
    active: Boolean(activeVideoId && activeVideoId === getVideoId()),
    inactiveTitle: guardedTooltip(getVideoId()),
    onToggle: toggleCurrentVideo,
    onBrowse: openSubtitleBrowserForPage,
  })
}, 1000)
void pollInterval

function toggleCurrentVideo(): void {
  const videoId = getVideoId()
  if (!videoId) return
  if (activeVideoId === videoId) {
    deactivateCurrentVideo('user')
  } else {
    void activateCurrentVideo(videoId, 'manual')
  }
}

function openSubtitleBrowserForPage(): void {
  openSubtitleBrowser({
    getCurrentVideoId: getVideoId,
    getCurrentVideoTitle: () => {
      const videoId = getVideoId()
      return videoId ? getVideoContext(videoId)?.title : undefined
    },
    seekCurrentVideo: (timeMs) => {
      const video = getVideoElement()
      if (!video) return
      video.currentTime = Math.max(0, timeMs / 1000)
      lastCueKey = ''
      store.setCurrentTime(video.currentTime * 1000)
    },
  })
}

async function activateCurrentVideo(
  videoId: string,
  intent: Exclude<TranslationActivationIntent, 'force-retranslation'>,
): Promise<void> {
  if (activeVideoId === videoId) return
  if (getVideoId() !== videoId) return

  suppressedVideoId = null
  guardedVideo = null
  store.reset()
  destroyStatus()
  destroyOverlay()
  overlay = createOverlay()
  overlay?.setActive(true)
  overlay?.setDisplayMode(loadSettings().displayMode)
  currentTrack = null
  translatingVideoId = null
  activeVideoId = videoId
  lastCueKey = ''
  const signal = store.signal
  console.log(`[Gistlate] ${intent === 'manual' ? 'Manual' : 'Automatic'} start: ${videoId}`)

  try {
    const acquired = await acquireCurrentSubtitles(videoId, loadSettings().tgt, {
      signal,
      onStage: showAcquisitionStage,
    })
    if (signal.aborted || getVideoId() !== videoId || activeVideoId !== videoId) return
    handleAcquiredTrack(acquired, intent)
  } catch (error) {
    if (signal.aborted) return
    console.warn('[Gistlate] Subtitle acquisition failed:', error)
    showAcquisitionError(acquisitionMessage(error))
    activeVideoId = null
    currentTrack = null
    translatingVideoId = null
    store.reset()
    destroyOverlay()
    overlay = null
  }
}

function showAcquisitionStage(stage: AcquisitionStage): void {
  if (stage === 'waiting-player') showWaitingPlayer()
  else if (stage === 'waiting-pot') showWaitingPot()
  else showFetchingSubtitles()
}

function acquisitionMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/No YouTube caption tracks/i.test(message)) return '当前视频没有可用字幕'
  if (/player data/i.test(message)) return '未能连接 YouTube 播放器字幕'
  if (/authorization|POT/i.test(message)) return 'YouTube 字幕授权失败'
  return '未能获取当前视频字幕'
}

function handleAcquiredTrack(
  acquired: AcquiredSubtitles,
  intent: Exclude<TranslationActivationIntent, 'force-retranslation'>,
): void {
  const { selected } = acquired
  const cues = cleanCues(parseTimedtext(acquired.json, { kind: selected.track.kind }))
  if (cues.length === 0) throw new Error('Selected YouTube caption track is empty')

  const srcLang = selected.track.languageCode || 'unknown'
  const directTarget = !captionTrackNeedsTranslation(selected, loadSettings().tgt)
  currentTrack = {
    videoId: selected.videoId,
    srcLang,
    fragments: cues,
    selected,
    directTarget,
  }
  console.log(
    `[Gistlate] Acquired ${cues.length} cues via ${acquired.source}: ` +
    `${selected.track.kind} ${srcLang} vss=${selected.track.vssId || '(none)'}`,
  )

  store.setSubtitle(srcLang, cues)
  overlay = createOverlay()
  overlay?.setActive(true)
  overlay?.setDisplayMode(loadSettings().displayMode)
  lastCueKey = ''

  if (directTarget) {
    showDirectReady()
    return
  }
  void triggerTranslation(selected.videoId, srcLang, cues, selected, intent)
}

async function triggerTranslation(
  videoId: string,
  srcLang: string,
  cues: Cue[],
  selected: SelectedCaptionTrack,
  intent: TranslationActivationIntent,
): Promise<void> {
  const force = intent === 'force-retranslation'
  const liveSettings = loadSettings()
  const tgt = normalizeLang(liveSettings.tgt)
  const src = normalizeLang(srcLang)

  if (src === tgt) {
    showDirectReady()
    if (force) window.alert('Gistlate：当前字幕语言与目标语言相同，无需重新翻译。')
    return
  }
  if (translatingVideoId === videoId) {
    if (force) window.alert('Gistlate：当前视频正在翻译，请完成后再试。')
    return
  }
  translatingVideoId = videoId
  const signal = store.signal
  overlay?.setDisplayMode(liveSettings.displayMode)
  let preflightGuard: GuardedEvaluation | undefined

  try {
    console.log(`[Gistlate] Resolving translation: ${videoId} ${src}→${tgt}`)
    const result = await resolveTranslation(videoId, src, cues, {
      signal,
      onTranslating: showTranslating,
      force,
      context: getVideoContext(videoId),
      getCurrentTime: () => store.currentTime,
      track: {
        languageCode: selected.track.languageCode,
        kind: selected.track.kind,
        vssId: selected.track.vssId,
      },
      beforeFreshTranslation: async () => {
        const outcome = await prepareFreshTranslation({
          videoId,
          cues,
          intent,
          signal,
          settings: liveSettings,
        })
        preflightGuard = outcome.guard
        return outcome.decision
      },
      onProgress: (progress) => {
        if (signal.aborted || getVideoId() !== videoId || activeVideoId !== videoId) return
        showProgress(progress)
        if (!force && progress.cues.length > 0) store.setSubtitle(srcLang, progress.cues)
      },
    })
    if (signal.aborted || getVideoId() !== videoId || activeVideoId !== videoId) return
    if (result.status === 'skipped') {
      console.log(`[Gistlate] Translation preflight skipped: ${result.reason}`)
      if (!force && preflightGuard) {
        enterGuardedVideo(videoId, preflightGuard, intent === 'automatic')
      }
      return
    }
    console.log(`[Gistlate] Translation ready (${result.source})`)
    if (result.source === 'fresh') showDone()
    else hideStatus()
    store.setSubtitle(srcLang, result.cues, result.artifact)
  } catch (error) {
    if (signal.aborted) {
      console.log('[Gistlate] Translation aborted (video stopped or superseded)')
    } else {
      console.warn('[Gistlate] Translation failed (showing original only):', error)
      if (shouldRestoreGuardAfterFailure(intent, Boolean(preflightGuard)) && preflightGuard) {
        enterGuardedVideo(videoId, preflightGuard, false)
      }
      showError()
    }
  } finally {
    if (translatingVideoId === videoId) translatingVideoId = null
  }
}

async function prepareFreshTranslation(input: {
  videoId: string
  cues: Cue[]
  intent: TranslationActivationIntent
  signal: AbortSignal
  settings: ReturnType<typeof loadSettings>
}): Promise<PreflightOutcome> {
  const { settings } = input
  const playback = getPlaybackFacts(input.videoId)
  const scale = measureCaptionScale(input.cues, playback.durationMs)
  const evaluation = evaluateLongVideoGuard(
    scale,
    playback.currentLive,
    settings.translation.autoTranslateLimitMinutes,
  )
  const action = selectTranslationPreflightAction(input.intent, evaluation)
  const guard = evaluation.action === 'guard' ? evaluation : undefined

  if (action === 'continue') return { decision: { action: 'continue' } }
  if (action === 'confirm-force-retranslation') {
    return window.confirm(
      '重新翻译会忽略现有缓存、调用当前配置的 LLM，并在完整成功后覆盖本地及 GitHub 翻译。是否继续？',
    )
      ? { decision: { action: 'continue' } }
      : { decision: { action: 'skip', reason: 'user-declined' } }
  }
  if (!guard) throw new Error(`Guard action ${action} is missing guard details`)
  if (action === 'skip-guard') {
    return {
      guard,
      decision: {
        action: 'skip',
        reason: guard.reason === 'current-live' ? 'current-live' : 'long-video',
      },
    }
  }

  const details = {
    title: getVideoContext(input.videoId).title,
    scale,
    mode: settings.translation.mode,
    batchSize: settings.translation.batchSize,
    risk: classifyRequestRisk(settings.translation.mode, scale),
    force: input.intent === 'force-retranslation',
    signal: input.signal,
  }
  if (action === 'show-live-notice') {
    await openCurrentLiveNotice(details)
    return { guard, decision: { action: 'skip', reason: 'current-live' } }
  }

  const dialogDecision = await openLongVideoConfirmation(details)
  if (dialogDecision === 'continue') {
    return { guard, decision: { action: 'continue' } }
  }
  if (dialogDecision === 'settings') {
    openSettingsPanel()
    return {
      guard,
      decision: { action: 'skip', reason: 'settings-opened' },
    }
  }
  return {
    guard,
    decision: { action: 'skip', reason: 'user-declined' },
  }
}

function enterGuardedVideo(
  videoId: string,
  evaluation: GuardedEvaluation,
  showAutomaticNotice: boolean,
): void {
  store.reset()
  currentTrack = null
  activeVideoId = null
  translatingVideoId = null
  lastCueKey = ''
  destroyOverlay()
  destroyStatus()
  overlay = null
  guardedVideo = {
    videoId,
    reason: evaluation.reason,
    scale: evaluation.scale,
  }
  if (!showAutomaticNotice) return
  if (evaluation.reason === 'current-live') showLiveGuarded()
  else {
    showLongVideoGuarded(formatDuration(
      evaluation.scale.spanMs ?? evaluation.scale.playerDurationMs,
    ))
  }
}

function guardedTooltip(videoId: string | null): string | undefined {
  if (!videoId || guardedVideo?.videoId !== videoId) return undefined
  return guardedVideo.reason === 'current-live'
    ? '直播保护：请在直播结束后重试'
    : '长视频保护：点击手动翻译'
}

function retranslateCurrentVideo(): void {
  const videoId = getVideoId()
  const track = currentTrack
  if (videoId && guardedVideo?.videoId === videoId) {
    if (translatingVideoId === videoId) return
    void activateCurrentVideo(videoId, 'manual')
    return
  }
  if (!videoId || !track || track.videoId !== videoId) {
    window.alert('Gistlate：当前视频尚未取得规范字幕轨道，请先启动 Gistlate 后重试。')
    return
  }
  if (translatingVideoId === videoId) {
    window.alert('Gistlate：当前视频正在翻译，请完成后再试。')
    return
  }
  void triggerTranslation(
    track.videoId,
    track.srcLang,
    track.fragments,
    track.selected,
    'force-retranslation',
  )
}

function deactivateCurrentVideo(
  reason: 'user' | 'navigation',
  previousPageVideoId: string | null = null,
): void {
  const previousVideoId = deactivatedVideoId({
    reason,
    activeVideoId,
    trackVideoId: currentTrack?.videoId ?? null,
    currentVideoId: getVideoId(),
    previousPageVideoId,
  })
  if (reason === 'user') suppressedVideoId = previousVideoId
  if (reason === 'navigation' && previousVideoId) clearObservedTimedtext(previousVideoId)
  destroyTranslationGuardDialog()
  store.reset()
  currentTrack = null
  activeVideoId = null
  translatingVideoId = null
  guardedVideo = null
  lastCueKey = ''
  destroyOverlay()
  destroyStatus()
  overlay = null
}

onVideoChange(() => {
  const nextVideoId = getVideoId()
  const previousPageVideoId = pageVideoId
  pageVideoId = nextVideoId
  if (nextVideoId && nextVideoId === activeVideoId) return
  if (nextVideoId && nextVideoId === suppressedVideoId) return
  if (nextVideoId && nextVideoId === guardedVideo?.videoId) return
  console.log('[Gistlate] Video changed')
  deactivateCurrentVideo('navigation', previousPageVideoId)
  detachTimeListener()
  suppressedVideoId = null
  const autoStartState = {
    videoId: nextVideoId,
    autoStart: loadSettings().autoStart,
    activeVideoId,
    suppressedVideoId,
    guardedVideoId: guardedVideo?.videoId ?? null,
  }
  if (shouldAutoStartVideo(autoStartState)) {
    void activateCurrentVideo(autoStartState.videoId, 'automatic')
  }
})

const initialVideoId = getVideoId()
const initialAutoStartState = {
  videoId: initialVideoId,
  autoStart: initialSettings.autoStart,
  activeVideoId,
  suppressedVideoId,
  guardedVideoId: null,
}
if (shouldAutoStartVideo(initialAutoStartState)) {
  void activateCurrentVideo(initialAutoStartState.videoId, 'automatic')
}
