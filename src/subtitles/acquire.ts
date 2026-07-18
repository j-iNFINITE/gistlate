import { getObservedPotUrl, getObservedTimedtext, getObservedTimedtextCandidates,
  waitForObservedTimedtext, type TimedtextPayload } from '../intercept/netHook'
import { gmFetch } from '../net/gm'
import {
  ensureCaptions,
  getPlayerCaptionData,
  type PlayerCaptionData,
} from '../youtube'
import { isTimedtextResponse, type GetTimedtextResp } from './timedtext'
import {
  isSameCaptionTrack,
  selectCanonicalTrack,
  type CaptionTrack,
  type SelectedCaptionTrack,
} from './tracks'

const PLAYER_WAIT_ATTEMPTS = 25
const PLAYER_WAIT_MS = 200
const POT_POLL_ATTEMPTS = 20
const POT_POLL_MS = 200
const OBSERVED_WAIT_MS = 5000
const INTERCEPT_ONLY_WAIT_MS = 1500
const RETRY_DELAY_MS = 300
const FAST_INTERCEPT_WAIT_MS = 6500

const DEVICE_KEYS = ['cbrand', 'cbr', 'cbrver', 'cos', 'cosver', 'cplatform'] as const

export type AcquisitionStage = 'waiting-player' | 'selecting-track' | 'fetching' | 'waiting-pot'

export interface AcquiredSubtitles {
  selected: SelectedCaptionTrack
  json: GetTimedtextResp
  source: 'intercept' | 'direct'
}

export interface AcquireOptions {
  signal?: AbortSignal
  onStage?: (stage: AcquisitionStage) => void
}

export class SubtitleAcquisitionError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_PLAYER' | 'NO_CAPTIONS' | 'HTTP' | 'INVALID_RESPONSE' | 'POT',
  ) {
    super(message)
    this.name = 'SubtitleAcquisitionError'
  }
}

/** Obtain exactly one canonical source/target track for the current Watch video. */
export async function acquireCurrentSubtitles(
  videoId: string,
  targetLanguage: string,
  options: AcquireOptions = {},
): Promise<AcquiredSubtitles> {
  const { signal, onStage } = options
  onStage?.('waiting-player')
  let playerData = await waitForPlayerData(videoId, signal)
  throwIfAborted(signal)

  if (!playerData) {
    // Preserve the old interception-only behavior when YouTube's player methods
    // are temporarily unavailable. Enabling CC is bounded to this active session.
    ensureCaptions()
    const observed = await waitForInterceptOnly(videoId, targetLanguage, signal)
    if (observed) return observed
    throw new SubtitleAcquisitionError('YouTube player data is unavailable', 'NO_PLAYER')
  }

  onStage?.('selecting-track')
  const selected = selectCanonicalTrack(
    videoId,
    playerData.captionTracks,
    targetLanguage,
    playerData.audioLanguage,
  )
  if (!selected) throw new SubtitleAcquisitionError('No YouTube caption tracks found', 'NO_CAPTIONS')
  const allowLanguageFallback = hasUniqueLanguageKind(playerData, selected.track)

  const alreadyObserved = getObservedTimedtext(videoId, selected.track, allowLanguageFallback)
  if (alreadyObserved) return fromObserved(selected, alreadyObserved)

  onStage?.('fetching')
  let fastError: unknown
  try {
    return await Promise.race([
      fetchTrack(selected.track, playerData, {}, signal, 1).then((json) => ({
        selected,
        json,
        source: 'direct' as const,
      })),
      waitForObservedAcquisition(
        videoId,
        selected,
        FAST_INTERCEPT_WAIT_MS,
        signal,
        allowLanguageFallback,
      ),
    ])
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof SubtitleAcquisitionError &&
      /HTTP (404|429)\b/.test(error.message)) throw error
    fastError = error
  }

  const observedAfterFastPath = getObservedTimedtext(
    videoId,
    selected.track,
    allowLanguageFallback,
  )
  if (observedAfterFastPath) return fromObserved(selected, observedAfterFastPath)

  onStage?.('waiting-pot')
  let tokens = extractPotTokens(selected.track, playerData, getObservedPotUrl(videoId))
  if (!tokens.pot) {
    ensureCaptions()
    for (let attempt = 0; attempt < POT_POLL_ATTEMPTS; attempt++) {
      await abortableDelay(POT_POLL_MS, signal)
      const next = getPlayerCaptionData(videoId)
      if (!next) continue
      playerData = next
      tokens = extractPotTokens(selected.track, playerData, getObservedPotUrl(videoId))
      if (tokens.pot) break
      const observed = getObservedTimedtext(videoId, selected.track, allowLanguageFallback)
      if (observed) return fromObserved(selected, observed)
    }
  }

  if (!tokens.pot) {
    const observed = await waitForObservedTimedtext(
      videoId,
      selected.track,
      OBSERVED_WAIT_MS,
      signal,
      allowLanguageFallback,
    )
    throwIfAborted(signal)
    if (observed) return fromObserved(selected, observed)
    tokens = extractPotTokens(selected.track, playerData, getObservedPotUrl(videoId))
  }

  if (!tokens.pot) {
    const detail = fastError instanceof Error ? `: ${fastError.message}` : ''
    throw new SubtitleAcquisitionError(`YouTube subtitle authorization unavailable${detail}`, 'POT')
  }

  const json = await fetchTrack(selected.track, playerData, tokens, signal, 3)
  return { selected, json, source: 'direct' }
}

async function waitForObservedAcquisition(
  videoId: string,
  selected: SelectedCaptionTrack,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  allowLanguageFallback: boolean,
): Promise<AcquiredSubtitles> {
  const payload = await waitForObservedTimedtext(
    videoId,
    selected.track,
    timeoutMs,
    signal,
    allowLanguageFallback,
  )
  if (payload) return fromObserved(selected, payload)
  // A timeout is not an acquisition result. Keep this race branch pending so
  // the active request remains responsible for success or failure.
  return new Promise<AcquiredSubtitles>(() => {})
}

function hasUniqueLanguageKind(playerData: PlayerCaptionData, selected: CaptionTrack): boolean {
  return playerData.captionTracks.filter((track) =>
    track.languageCode.toLowerCase() === selected.languageCode.toLowerCase() &&
    track.kind === selected.kind,
  ).length === 1
}

async function waitForPlayerData(
  videoId: string,
  signal?: AbortSignal,
): Promise<PlayerCaptionData | null> {
  for (let attempt = 0; attempt < PLAYER_WAIT_ATTEMPTS; attempt++) {
    throwIfAborted(signal)
    const data = getPlayerCaptionData(videoId)
    if (data?.captionTracks.length) return data
    await abortableDelay(PLAYER_WAIT_MS, signal)
  }
  return null
}

async function waitForInterceptOnly(
  videoId: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<AcquiredSubtitles | undefined> {
  const deadline = Date.now() + INTERCEPT_ONLY_WAIT_MS
  do {
    throwIfAborted(signal)
    const candidates = getObservedTimedtextCandidates(videoId)
    const selected = selectCanonicalTrack(
      videoId,
      candidates.map((candidate) => candidate.track),
      targetLanguage,
    )
    if (selected) {
      const payload = candidates.find((candidate) =>
        isSameCaptionTrack(candidate.track, selected.track),
      )
      if (payload) return fromObserved(selected, payload)
    }
    await abortableDelay(100, signal)
  } while (Date.now() < deadline)
  return undefined
}

function fromObserved(
  selected: SelectedCaptionTrack,
  payload: TimedtextPayload,
): AcquiredSubtitles {
  return { selected, json: payload.json, source: 'intercept' }
}

export interface PotTokens {
  pot?: string
  potc?: string
}

export function extractPotTokens(
  selected: CaptionTrack,
  playerData: PlayerCaptionData,
  observedUrl?: string,
): PotTokens {
  const matching = playerData.audioCaptionTracks.find((track) =>
    Boolean(track.vssId) && track.vssId === selected.vssId,
  ) ?? playerData.audioCaptionTracks.find((track) =>
    track.languageCode === selected.languageCode && track.kind === selected.kind,
  ) ?? playerData.audioCaptionTracks.find((track) =>
    track.languageCode === selected.languageCode,
  )

  for (const value of [matching?.url, observedUrl, selected.baseUrl]) {
    if (!value) continue
    try {
      const url = new URL(value, 'https://www.youtube.com')
      const pot = url.searchParams.get('pot') || undefined
      if (pot) return { pot, potc: url.searchParams.get('potc') || undefined }
    } catch {
      // Ignore malformed optional POT sources; the selected base URL is later
      // validated by the actual request builder.
    }
  }
  return {}
}

export function buildTimedtextUrl(
  track: CaptionTrack,
  playerData: Pick<PlayerCaptionData, 'device' | 'clientVersion'>,
  tokens: PotTokens = {},
): string {
  const url = new URL(track.baseUrl, 'https://www.youtube.com')
  for (const [key, value] of Object.entries({
    fmt: 'json3',
    xorb: '2',
    xobt: '3',
    xovt: '3',
    c: 'WEB',
    cplayer: 'UNIPLAYER',
  })) url.searchParams.set(key, value)

  if (playerData.device) {
    const device = new URLSearchParams(playerData.device)
    for (const key of DEVICE_KEYS) {
      const value = device.get(key)
      if (value) url.searchParams.set(key, value)
    }
  }
  if (playerData.clientVersion) url.searchParams.set('cver', playerData.clientVersion)
  if (tokens.pot) url.searchParams.set('pot', tokens.pot)
  if (tokens.potc) url.searchParams.set('potc', tokens.potc)
  return url.toString()
}

async function fetchTrack(
  track: CaptionTrack,
  playerData: PlayerCaptionData,
  tokens: PotTokens,
  signal: AbortSignal | undefined,
  attempts: number,
): Promise<GetTimedtextResp> {
  const url = buildTimedtextUrl(track, playerData, tokens)
  let lastError: Error | undefined
  for (let attempt = 0; attempt < attempts; attempt++) {
    throwIfAborted(signal)
    try {
      const response = await gmFetch({ method: 'GET', url, signal, timeoutMs: 6000 })
      if (response.status !== 200) {
        throw new SubtitleAcquisitionError(
          `YouTube timedtext returned HTTP ${response.status}`,
          'HTTP',
        )
      }
      const value: unknown = JSON.parse(response.text)
      if (!isTimedtextResponse(value)) {
        throw new SubtitleAcquisitionError('Invalid YouTube JSON3 response', 'INVALID_RESPONSE')
      }
      return value
    } catch (error) {
      if (signal?.aborted || error instanceof SubtitleAcquisitionError &&
        error.code === 'HTTP' && /HTTP (403|404|429)\b/.test(error.message)) {
        throw error
      }
      lastError = error as Error
      if (attempt < attempts - 1) await abortableDelay(RETRY_DELAY_MS * (attempt + 1), signal)
    }
  }
  throw lastError ?? new SubtitleAcquisitionError('YouTube subtitle request failed', 'HTTP')
}

export { isTimedtextResponse }

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Subtitle acquisition aborted', 'AbortError')
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Subtitle acquisition aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Subtitle acquisition aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
