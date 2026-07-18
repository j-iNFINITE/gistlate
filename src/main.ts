/// <reference types="vite-plugin-monkey/client" />
import { GM_registerMenuCommand } from '$'
import { loadSettings } from './settings'
import { interceptTimedtext } from './intercept/netHook'
import { parseTimedtext, type Cue } from './subtitles/timedtext'
import { cleanCues } from './subtitles/clean'
import { findCueAt } from './subtitles/cues'
import { normalizeLang } from './translate/lang'
import {
  getVideoId,
  getVideoContext,
  onVideoChange,
  ensureCaptions,
  getVideoElement,
  isTimedtextRequestForVideo,
} from './youtube'
import { store } from './core/store'
import { resolveTranslation } from './core/resolve'
import { createOverlay, destroyOverlay } from './ui/overlay'
import { openSettingsPanel } from './ui/settings-panel'
import { openStylePanel } from './ui/style-panel'
import { mountStyleButton } from './ui/style-button'
import {
  showTranslating,
  showProgress,
  showDone,
  showError,
  destroyStatus,
} from './ui/status'
import { reconcileStaleUsageOperations } from './usage/ledger'

console.log('[Gistlate] Script loaded on YouTube')

// A tab/browser crash can leave a billed operation marked running. Reconcile
// it once on the next userscript initialization without fabricating new usage.
void reconcileStaleUsageOperations().catch((error) => {
  console.warn('[Gistlate] Could not reconcile stale usage operations', error)
})

// ── Settings ──────────────────────────────────────────
const settings = loadSettings()
console.log('[Gistlate] Settings loaded:', {
  tgt: settings.tgt,
  displayMode: settings.displayMode,
  openai: `baseUrl=${settings.openai.baseUrl} model=${settings.openai.model}`,
  github: `owner=${settings.github.owner} repo=${settings.github.repo}`,
})

// ── GM menu command → settings panel ────────────────
GM_registerMenuCommand('Gistlate 设置', () => {
  openSettingsPanel()
})

// ── GM menu command → live subtitle style panel ─────
GM_registerMenuCommand('Gistlate 字幕样式', () => {
  openStylePanel()
})

// Low-frequency, quota-consuming action: keep it in the userscript menu rather
// than adding another persistent player control.
GM_registerMenuCommand('Gistlate 重新翻译当前视频', () => {
  retranslateCurrentVideo()
})

// ── Overlay state ─────────────────────────────────────
let overlay = createOverlay()
overlay?.setDisplayMode(settings.displayMode)

// ── Playhead tracking ────────────────────────────────
let lastCueKey = ''

function updateOverlay(timeMs: number): void {
  if (!store.subtitle) return

  // Lazy (re)create the overlay: it may have been null at document-start
  // (player not mounted yet) or nulled after SPA navigation.
  if (!overlay) {
    overlay = createOverlay()
    overlay?.setDisplayMode(settings.displayMode)
    if (!overlay) return
  }

  const cue = findCueAt(store.subtitle.cues, timeMs)
  const key = cue ? `${cue.s}|${cue.o}|${cue.t ?? ''}` : ''

  if (key === lastCueKey) return
  lastCueKey = key

  if (cue) {
    overlay.update(cue.o, cue.t)
  } else {
    overlay.update('')
  }
}

// Subscribe to store time changes
const unsubTime = store.subscribe(updateOverlay)

// ── Video time listener ──────────────────────────────
let videoEl: HTMLVideoElement | null = null
let timeHandler: (() => void) | null = null

function attachTimeListener(): void {
  const v = getVideoElement()
  if (!v || v === videoEl) return
  videoEl = v

  timeHandler = () => store.setCurrentTime(v.currentTime * 1000)
  v.addEventListener('timeupdate', timeHandler)
  // Seek: force an immediate refresh. Reset the dedup key first so updateOverlay
  // re-renders even when findCueAt returns a cue whose key looks unchanged —
  // otherwise the overlay could show a stale line right after a jump.
  v.addEventListener('seeked', () => {
    lastCueKey = ''
    store.setCurrentTime(v.currentTime * 1000)
  })
}

// Poll for video element since it may not exist at document-start
const pollInterval = setInterval(() => {
  if (!videoEl) {
    attachTimeListener()
  }
  // (Re)inject the style button; survives YouTube rebuilding its controls.
  mountStyleButton()
}, 1000)

// ── Subtitle interception ─────────────────────────────
let handledTrackKey = ''
let handledVideoId = ''

interface CurrentTrack {
  videoId: string
  srcLang: string
  /** Cleaned original fragments; never replace with reconstructed sentence cues. */
  fragments: Cue[]
}

let currentTrack: CurrentTrack | null = null

interceptTimedtext(({ json, params }) => {
  const videoId = getVideoId()
  // A late timedtext response from the previous SPA page must never be parsed,
  // deduplicated, displayed, or cached under the current watch URL.
  if (!isTimedtextRequestForVideo(params, videoId)) return
  if (!videoId) return

  const rawLang = params.get('lang')
  const tlang = params.get('tlang')

  // Skip auto-translated tracks — we want the original source
  if (tlang) return

  if (!json.events || json.events.length === 0) return

  const srcLang = rawLang ?? 'unknown'
  const trackKey = `${videoId}|${srcLang}`

  // Dedup: YouTube requests the same caption track multiple times. Ignoring
  // repeats is critical — otherwise store.reset() below aborts the in-flight
  // translation started by the first request, and it never completes.
  if (trackKey === handledTrackKey) return
  handledTrackKey = trackKey
  handledVideoId = videoId

  // Strip non-speech annotations ([Music], 【音乐】, ♪, …) up front so they never
  // display and never pollute sentence segmentation. Pure-annotation cues drop.
  const cues = cleanCues(parseTimedtext(json))
  if (cues.length === 0) {
    currentTrack = null
    return
  }

  currentTrack = { videoId, srcLang, fragments: cues }

  console.log(`[Gistlate] Captured ${cues.length} cues for video=${videoId} lang=${srcLang}`)

  // Reset state for this (new video, or a newly-selected caption track)
  store.reset()
  store.setSubtitle(srcLang, cues)
  overlay = createOverlay()
  overlay?.setDisplayMode(settings.displayMode)
  lastCueKey = ''

  // Try enabling captions so next video auto-starts
  ensureCaptions()

  // Trigger whole-track planning; canonical sentence jobs then run progressively.
  triggerTranslation(videoId, srcLang, cues)
})

let translatingVideoId: string | null = null

async function triggerTranslation(
  videoId: string,
  srcLang: string,
  cues: Cue[],
  force = false,
): Promise<void> {
  // Settings can change after the userscript starts. Read them at each operation
  // so explicit retranslation always uses the current target/API configuration.
  const liveSettings = loadSettings()
  const tgt = normalizeLang(liveSettings.tgt)
  const src = normalizeLang(srcLang)

  // Same language → no translation needed
  if (src === tgt) {
    console.log('[Gistlate] Source and target languages are the same, skipping translation')
    if (force) window.alert('Gistlate：当前字幕语言与目标语言相同，无需重新翻译。')
    return
  }

  // Guard by videoId (not a global boolean): prevents translating the same
  // video twice (e.g. manual + ASR tracks firing), but never blocks a *new*
  // video whose interception arrives while an old translation is aborting.
  if (translatingVideoId === videoId) {
    if (force) window.alert('Gistlate：当前视频正在翻译，请完成后再试。')
    return
  }
  translatingVideoId = videoId

  // Capture the signal now; if navigation resets the store mid-flight, this
  // signal aborts and we discard the stale result.
  const signal = store.signal
  overlay?.setDisplayMode(liveSettings.displayMode)

  try {
    console.log(`[Gistlate] Resolving translation: ${videoId} ${src}→${tgt}`)
    const result = await resolveTranslation(videoId, src, cues, {
      signal,
      onTranslating: showTranslating,
      force,
      context: getVideoContext(videoId),
      getCurrentTime: () => store.currentTime,
      onProgress: (progress) => {
        if (signal.aborted || getVideoId() !== videoId) return
        showProgress(progress)
        // Fresh translation may mix completed targets with original-only pending
        // cues in memory. Force mode keeps the old complete artifact atomically.
        if (!force && progress.cues.length > 0) {
          store.setSubtitle(srcLang, progress.cues)
        }
      },
    })

    // Staleness guard: covers the cache-hit path where resolve returns fast
    // without re-checking the signal after its async lookups.
    if (signal.aborted || getVideoId() !== videoId) {
      console.log('[Gistlate] Discarding stale translation result (navigated away)')
      return
    }

    console.log(`[Gistlate] Translation ready (${result.source})`)
    // Only flash "done" when we actually translated (the pill was shown).
    if (result.source === 'fresh') showDone()
    store.setSubtitle(srcLang, result.cues)
  } catch (e) {
    if (signal.aborted) {
      console.log('[Gistlate] Translation aborted (superseded by a newer track)')
    } else {
      console.warn('[Gistlate] Translation failed (will show original only):', e)
      showError()
    }
  } finally {
    // This is in-flight state, not a permanent "already translated" guard.
    // Network-track duplicates remain blocked by handledTrackKey.
    if (translatingVideoId === videoId) translatingVideoId = null
  }
}

function retranslateCurrentVideo(): void {
  const videoId = getVideoId()
  const track = currentTrack

  if (!videoId || !track || track.videoId !== videoId) {
    window.alert(
      'Gistlate：尚未捕获当前视频的原始字幕。请先打开 YouTube 字幕（CC）后重试。',
    )
    return
  }

  if (translatingVideoId === videoId) {
    window.alert('Gistlate：当前视频正在翻译，请完成后再试。')
    return
  }

  const confirmed = window.confirm(
    '重新翻译会忽略现有缓存、调用当前配置的 LLM，并在完整成功后覆盖本地及 GitHub 翻译。是否继续？',
  )
  if (!confirmed) return

  void triggerTranslation(track.videoId, track.srcLang, track.fragments, true)
}

// ── SPA navigation ────────────────────────────────────
// `yt-navigate-finish` can fire AFTER the initial interception already started a
// translation. If it reports the SAME video we're already handling, do nothing —
// otherwise we'd abort the in-flight translation and re-translate on the repeat
// interception. Only a genuinely different (or absent) video resets state.
onVideoChange(() => {
  const newId = getVideoId()
  if (newId && newId === handledVideoId) return
  console.log('[Gistlate] Video changed')
  store.reset()
  destroyOverlay()
  destroyStatus()
  overlay = null // force lazy re-creation for the next track
  translatingVideoId = null // allow the next video to translate
  handledTrackKey = '' // allow the next video's track to be handled
  handledVideoId = ''
  currentTrack = null
  videoEl = null
  lastCueKey = ''
})
