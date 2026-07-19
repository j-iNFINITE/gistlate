import { unsafeWindow } from '$'
import {
  normalizeTranslationContext,
  type TranslationContext,
} from './translate/context'
import type { CaptionTrack, CaptionTrackKind } from './subtitles/tracks'

/**
 * YouTube-specific helpers: video ID extraction, SPA navigation detection,
 * programmatic caption toggling.
 */

interface PlayerResponse {
  videoDetails?: {
    videoId?: string
    title?: string
    shortDescription?: string
    defaultLanguage?: string
    defaultAudioLanguage?: string
    isLive?: boolean
    isLiveContent?: boolean
  }
  microformat?: {
    playerMicroformatRenderer?: {
      liveBroadcastDetails?: {
        isLiveNow?: boolean
        endTimestamp?: string
      }
    }
  }
  playabilityStatus?: {
    liveStreamability?: unknown
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: RawCaptionTrack[]
    }
  }
}

interface RawCaptionTrack {
  baseUrl?: string
  languageCode?: string
  kind?: string
  vssId?: string
  vss_id?: string
  name?: { simpleText?: string; runs?: Array<{ text?: string }> }
}

interface RawAudioCaptionTrack {
  url?: string
  vssId?: string
  vss_id?: string
  kind?: string
  languageCode?: string
}

interface YouTubePlayer extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse
  getAudioTrack?: () => {
    id?: string
    languageCode?: string
    language?: string
    captionTracks?: RawAudioCaptionTrack[]
  }
  getPlayerState?: () => number
  getWebPlayerContextConfig?: () => { innertubeContextClientVersion?: string }
  getOption?: (module: string, option: string) => RawCaptionTrack | undefined
  toggleSubtitles?: () => void
}

export interface AudioCaptionTrack {
  url: string
  vssId: string
  languageCode?: string
  kind: CaptionTrackKind
}

export interface PlayerCaptionData {
  videoId: string
  captionTracks: CaptionTrack[]
  audioCaptionTracks: AudioCaptionTrack[]
  audioLanguage?: string
  playerState: number
  device?: string
  clientVersion?: string
}

export interface PlaybackFacts {
  currentLive: boolean
  durationMs?: number
}

let videoIdCache: string | null = null

/** Extract the current video ID from the YouTube page URL. */
export function getVideoId(): string | null {
  const m = location.pathname.match(/^\/watch$/)
  if (!m) return null
  const v = new URLSearchParams(location.search).get('v')
  return v ?? null
}

/** Reject late SPA timedtext responses that belong to a different watch video. */
export function isTimedtextRequestForVideo(
  params: URLSearchParams,
  currentVideoId: string | null = getVideoId(),
): boolean {
  const requestVideoId = params.get('v')
  return !!requestVideoId && !!currentVideoId && requestVideoId === currentVideoId
}

/** Get the player element. */
export function getPlayer(): HTMLElement | null {
  return document.querySelector('#movie_player')
}

function getYouTubePlayer(): YouTubePlayer | null {
  const pageDocument = (unsafeWindow as typeof unsafeWindow & {
    document?: Document
  }).document ?? document
  return pageDocument.querySelector<YouTubePlayer>('#movie_player')
}

/** Get the native <video> element inside the player. */
export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>('#movie_player video')
}

/** Read current-live and finite-duration facts without treating ended replays as live. */
export function getPlaybackFacts(expectedVideoId: string): PlaybackFacts {
  const pageWindow = unsafeWindow as typeof unsafeWindow & {
    ytInitialPlayerResponse?: PlayerResponse
  }
  const player = getYouTubePlayer()
  const responses = [
    safePlayerCall(() => player?.getPlayerResponse?.()),
    pageWindow.ytInitialPlayerResponse,
  ].filter((candidate): candidate is PlayerResponse =>
    candidate?.videoDetails?.videoId === expectedVideoId,
  )
  const rawDurationSeconds = getVideoElement()?.duration
  const infiniteDuration = rawDurationSeconds === Number.POSITIVE_INFINITY
  const rawDurationMs = typeof rawDurationSeconds === 'number' &&
    Number.isFinite(rawDurationSeconds) && rawDurationSeconds >= 0
    ? rawDurationSeconds * 1000
    : undefined
  const durationMs = typeof rawDurationMs === 'number' && Number.isFinite(rawDurationMs)
    ? rawDurationMs
    : undefined
  // YouTube's expando and initial response may each omit different live fields;
  // merge all same-video facts rather than trusting the first matching object.
  const ended = responses.some((response) => Boolean(
    response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.endTimestamp,
  ))
  const currentLive = !ended && (
    responses.some((response) =>
      response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true,
    ) ||
    responses.some((response) => response.videoDetails?.isLive === true) ||
    infiniteDuration ||
    responses.some((response) => Boolean(
      response.playabilityStatus?.liveStreamability && response.videoDetails?.isLiveContent,
    ))
  )
  return {
    currentLive,
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

/**
 * Read reference-only metadata for the current watch video.
 *
 * YouTube may leave the previous `ytInitialPlayerResponse` visible briefly
 * during SPA navigation, so player-response metadata is accepted only when its
 * video ID matches the expected/current URL. DOM metadata is a soft fallback.
 */
export function getVideoContext(
  expectedVideoId: string | null = getVideoId(),
): TranslationContext {
  const pageWindow = unsafeWindow as typeof unsafeWindow & {
    ytInitialPlayerResponse?: PlayerResponse
  }
  const details = pageWindow.ytInitialPlayerResponse?.videoDetails
  const matchingDetails =
    expectedVideoId && details?.videoId === expectedVideoId ? details : undefined

  const title =
    matchingDetails?.title ||
    firstMetaContent(['meta[itemprop="name"]', 'meta[property="og:title"]']) ||
    document.title.replace(/\s*-\s*YouTube\s*$/i, '')
  const description =
    matchingDetails?.shortDescription ||
    firstMetaContent([
      'meta[itemprop="description"]',
      'meta[property="og:description"]',
      'meta[name="description"]',
    ])

  return normalizeTranslationContext({ title, description })
}

function firstMetaContent(selectors: string[]): string {
  for (const selector of selectors) {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content
    if (content?.trim()) return content
  }
  return ''
}

/**
 * Check whether the current page has a captions button available.
 */
export function hasCaptions(): boolean {
  return !!document.querySelector('.ytp-subtitles-button')
}

/**
 * Programmatically enable captions if they are off.
 */
export function ensureCaptions(): boolean {
  const player = getYouTubePlayer()
  const btn = document.querySelector<HTMLElement>(
    '.ytp-subtitles-button[aria-pressed="false"]',
  )
  if (btn) {
    if (player?.toggleSubtitles) {
      try {
        player.toggleSubtitles()
      } catch {
        btn.click()
      }
    } else btn.click()
    return true
  }
  return false
}

/**
 * Read the current Watch player's caption inventory. YouTube leaves stale page
 * data around during SPA navigation, so no track escapes without a video-ID
 * match against the expected URL video.
 */
export function getPlayerCaptionData(expectedVideoId: string): PlayerCaptionData | null {
  const player = getYouTubePlayer()
  const pageWindow = unsafeWindow as typeof unsafeWindow & {
    ytInitialPlayerResponse?: PlayerResponse
    ytcfg?: { get?: (key: string) => string | undefined }
  }
  const responses = [
    safePlayerCall(() => player?.getPlayerResponse?.()),
    pageWindow.ytInitialPlayerResponse,
  ]
  const response = responses.find((candidate) => candidate?.videoDetails?.videoId === expectedVideoId)
  if (!response) return null

  const rawTracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  const selected = safePlayerCall(() => player?.getOption?.('captions', 'track'))
  const selectedVssId = vssIdOf(selected)
  const selectedLanguage = selected?.languageCode
  const selectedKind = kindOf(selected?.kind)
  const rawAudio = safePlayerCall(() => player?.getAudioTrack?.())
  const audioLanguage = firstLanguage(
    rawAudio?.languageCode,
    rawAudio?.language,
    languageFromAudioId(rawAudio?.id),
    response.videoDetails?.defaultAudioLanguage,
    response.videoDetails?.defaultLanguage,
  )
  const audioCaptionTracks = normalizeAudioCaptionTracks(rawAudio?.captionTracks)
  const audioVssIds = new Set(audioCaptionTracks.map((track) => track.vssId).filter(Boolean))

  const captionTracks = rawTracks.flatMap((raw): CaptionTrack[] => {
    if (!raw.baseUrl || !raw.languageCode) return []
    const vssId = vssIdOf(raw) || vssIdFromUrl(raw.baseUrl)
    const kind = kindOf(raw.kind)
    const selectedByLanguage = !selectedVssId && selectedLanguage === raw.languageCode &&
      selectedKind === kind
    return [{
      baseUrl: absoluteYouTubeUrl(raw.baseUrl),
      languageCode: raw.languageCode,
      kind,
      vssId,
      name: trackName(raw.name),
      selected: selectedVssId ? selectedVssId === vssId : selectedByLanguage,
      audioLanguageMatch: audioVssIds.has(vssId) || (
        Boolean(audioLanguage) && raw.languageCode.toLowerCase() === audioLanguage?.toLowerCase()
      ),
    }]
  })

  return {
    videoId: expectedVideoId,
    captionTracks,
    audioCaptionTracks,
    audioLanguage,
    playerState: safePlayerCall(() => player?.getPlayerState?.()) ?? -1,
    device: safePlayerCall(() => pageWindow.ytcfg?.get?.('DEVICE')) || undefined,
    clientVersion: safePlayerCall(
      () => player?.getWebPlayerContextConfig?.()?.innertubeContextClientVersion,
    ),
  }
}

function safePlayerCall<T>(call: () => T | undefined): T | undefined {
  try {
    return call()
  } catch {
    return undefined
  }
}

function normalizeAudioCaptionTracks(rawTracks?: RawAudioCaptionTrack[]): AudioCaptionTrack[] {
  return (rawTracks ?? []).flatMap((raw): AudioCaptionTrack[] => {
    if (!raw.url) return []
    let url: URL
    try {
      url = new URL(raw.url, 'https://www.youtube.com')
    } catch {
      return []
    }
    return [{
      url: url.toString(),
      vssId: raw.vssId || raw.vss_id || url.searchParams.get('vssId') ||
        url.searchParams.get('vss_id') || '',
      languageCode: raw.languageCode || url.searchParams.get('lang') || undefined,
      kind: kindOf(raw.kind || url.searchParams.get('kind') || undefined),
    }]
  })
}

function vssIdOf(track?: RawCaptionTrack): string {
  return track?.vssId || track?.vss_id || (track?.baseUrl ? vssIdFromUrl(track.baseUrl) : '')
}

function vssIdFromUrl(value: string): string {
  try {
    const url = new URL(value, 'https://www.youtube.com')
    return url.searchParams.get('vssId') || url.searchParams.get('vss_id') || ''
  } catch {
    return ''
  }
}

function kindOf(kind?: string): CaptionTrackKind {
  return kind === 'asr' ? 'asr' : 'manual'
}

function trackName(name?: RawCaptionTrack['name']): string | undefined {
  const text = name?.simpleText || name?.runs?.map((run) => run.text || '').join('')
  return text?.trim() || undefined
}

function absoluteYouTubeUrl(value: string): string {
  try {
    return new URL(value, 'https://www.youtube.com').toString()
  } catch {
    return value
  }
}

function languageFromAudioId(id?: string): string | undefined {
  const match = id?.match(/^([a-z]{2,3}(?:-[A-Za-z0-9]+)*)(?:\.|$)/)
  return match?.[1]
}

function firstLanguage(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim()
}

/**
 * Listen for YouTube SPA navigation.
 * Returns a cleanup function.
 */
export function onNavigate(handler: () => void): () => void {
  document.addEventListener('yt-navigate-finish', handler)
  return () => document.removeEventListener('yt-navigate-finish', handler)
}

/**
 * Watch for video ID changes (re-export of onNavigate with ID tracking).
 * Only fires the handler when the video actually changes.
 */
export function onVideoChange(handler: () => void): () => void {
  return onNavigate(() => {
    const id = getVideoId()
    if (id !== videoIdCache) {
      videoIdCache = id
      handler()
    }
  })
}

/** Reset the cached video ID (for cleanup). */
export function resetVideoId(): void {
  videoIdCache = null
}
