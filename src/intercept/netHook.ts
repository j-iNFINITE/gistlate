import { unsafeWindow } from '$'
import { isTimedtextResponse, type GetTimedtextResp } from '../subtitles/timedtext'
import { isSameCaptionTrack, type CaptionTrack } from '../subtitles/tracks'

/**
 * Minimal, dependency-free fetch + XHR interceptor.
 * Patches `unsafeWindow.fetch` and `XMLHttpRequest` to emit parsed timedtext
 * responses *without* modifying the response stream (observe-only).
 *
 * This is a clean-room implementation inspired by the *idea* from bilingualtube.
 * No code is copied from that project.
 */

export interface TimedtextPayload {
  url: string
  json: GetTimedtextResp
  params: URLSearchParams
  videoId: string
  track: CaptionTrack
}

export type TimedtextHandler = (payload: TimedtextPayload) => void

let registeredHandler: TimedtextHandler | null = null
const observedPayloads = new Map<string, TimedtextPayload[]>()
const observedPotUrls = new Map<string, string>()
const observedListeners = new Set<(payload: TimedtextPayload) => void>()
const MAX_OBSERVED_TRACKS_PER_VIDEO = 12

/** Start intercepting timedtext requests. Returns a stop function. */
export function interceptTimedtext(handler: TimedtextHandler): () => void {
  if (registeredHandler) {
    console.warn('[Gistlate] Intercept already registered; replacing handler.')
  }
  registeredHandler = handler

  const of = unsafeWindow.fetch.bind(unsafeWindow)
  const OXHR = unsafeWindow.XMLHttpRequest

  // ── Fetch patch (observe-only, pass-through) ──
  // IMPORTANT: forward the original (input, init) untouched. Never reconstruct
  // the Request — YouTube uses streaming/duplex bodies on some requests and
  // `new Request(input, init)` would consume or break them. We only clone the
  // *response* (safe) to read timedtext.
  unsafeWindow.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = requestUrl(input)
    if (url) observeTimedtextUrl(url)
    const res = await of(input, init)
    if (url && parseTimedtextUrl(url)) {
      res
        .clone()
        .json()
        .then((json: unknown) => {
          if (isTimedtextResponse(json)) emit(url, json)
        })
        .catch(() => {
          /* not JSON (e.g. srv3/xml) or parse error — ignore silently */
        })
    }
    return res
  }

  // ── XHR patch (observe-only) ─────────────────
  const originalOpen = OXHR.prototype.open
  const originalSend = OXHR.prototype.send

  OXHR.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
  ): void {
    this.__gistlateUrl = typeof url === 'string' ? url : url.href
    observeTimedtextUrl(this.__gistlateUrl)
    return originalOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest['open']>)
  }

  OXHR.prototype.send = function (
    this: XMLHttpRequest,
    ...args: unknown[]
  ): void {
    const url = this.__gistlateUrl
    if (url && parseTimedtextUrl(url)) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState === 4) {
          try {
            const json: unknown = JSON.parse(this.responseText)
            if (isTimedtextResponse(json)) emit(url, json)
          } catch {
            /* ignore parse errors */
          }
        }
      })
    }
    return originalSend.apply(this, args as unknown as Parameters<XMLHttpRequest['send']>)
  }

  // Return cleanup function
  return () => {
    registeredHandler = null
    unsafeWindow.fetch = of
    OXHR.prototype.open = originalOpen
    OXHR.prototype.send = originalSend
  }
}

export function parseTimedtextUrl(url: string): URL | null {
  try {
    const parsed = new URL(url, 'https://www.youtube.com')
    const isYouTube = parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com')
    return isYouTube && parsed.pathname === '/api/timedtext' ? parsed : null
  } catch {
    return null
  }
}

/** Extract the URL string from a fetch `input` without consuming it. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if ('href' in input && typeof input.href === 'string') return input.href
  return 'url' in input && typeof input.url === 'string' ? input.url : ''
}

let pendingEmit: string | null = null

function emit(url: string, json: GetTimedtextResp): void {
  const parsed = parseTimedtextUrl(url)
  if (!parsed) return
  const params = parsed.searchParams
  const payload = timedtextPayload(parsed.toString(), params, json)
  if (!payload) return
  // Dedup: skip if the same track was already emitted in this tick.
  const vidKey = `${payload.videoId}|${payload.track.languageCode}|${payload.track.kind}|${payload.track.vssId}`
  // Store ID to avoid double-firing for XHR + fetch on the same request
  if (pendingEmit === vidKey) return
  pendingEmit = vidKey
  queueMicrotask(() => {
    pendingEmit = null
  })
  rememberPayload(payload)
  registeredHandler?.(payload)
}

function observeTimedtextUrl(value: string): void {
  const url = parseTimedtextUrl(value)
  if (!url) return
  const videoId = url.searchParams.get('v')
  if (videoId && url.searchParams.has('pot')) observedPotUrls.set(videoId, url.toString())
}

function timedtextPayload(
  url: string,
  params: URLSearchParams,
  json: GetTimedtextResp,
): TimedtextPayload | null {
  const videoId = params.get('v')
  const languageCode = params.get('lang')
  // YouTube auto-translation is a derived target, never a canonical source.
  if (!videoId || !languageCode || params.get('tlang')) return null
  return {
    url,
    json,
    params,
    videoId,
    track: {
      baseUrl: url,
      languageCode,
      kind: params.get('kind') === 'asr' ? 'asr' : 'manual',
      vssId: params.get('vssId') || params.get('vss_id') || '',
      name: params.get('name') || undefined,
    },
  }
}

function rememberPayload(payload: TimedtextPayload): void {
  const existing = observedPayloads.get(payload.videoId) ?? []
  const withoutSame = existing.filter((item) => !isSameCaptionTrack(item.track, payload.track))
  withoutSame.push(payload)
  observedPayloads.set(
    payload.videoId,
    withoutSame.slice(-MAX_OBSERVED_TRACKS_PER_VIDEO),
  )
  observedListeners.forEach((listener) => listener(payload))
}

export function getObservedTimedtext(
  videoId: string,
  track?: CaptionTrack,
  allowLanguageFallback = false,
): TimedtextPayload | undefined {
  const payloads = observedPayloads.get(videoId) ?? []
  return track
    ? payloads.find((payload) => matchesObservedTrack(
        track,
        payload.track,
        allowLanguageFallback,
      ))
    : payloads[payloads.length - 1]
}

export function getObservedTimedtextCandidates(videoId: string): TimedtextPayload[] {
  return [...(observedPayloads.get(videoId) ?? [])]
}

export function getObservedPotUrl(videoId: string): string | undefined {
  return observedPotUrls.get(videoId)
}

export function waitForObservedTimedtext(
  videoId: string,
  track: CaptionTrack,
  timeoutMs: number,
  signal?: AbortSignal,
  allowLanguageFallback = false,
): Promise<TimedtextPayload | undefined> {
  const existing = getObservedTimedtext(videoId, track, allowLanguageFallback)
  if (existing || signal?.aborted) return Promise.resolve(existing)

  return new Promise((resolve) => {
    let settled = false
    const finish = (payload?: TimedtextPayload): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      observedListeners.delete(listener)
      signal?.removeEventListener('abort', onAbort)
      resolve(payload)
    }
    const listener = (payload: TimedtextPayload): void => {
      if (payload.videoId === videoId && matchesObservedTrack(
        track,
        payload.track,
        allowLanguageFallback,
      )) finish(payload)
    }
    const onAbort = (): void => finish()
    const timer = setTimeout(() => finish(), timeoutMs)
    observedListeners.add(listener)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function matchesObservedTrack(
  selected: CaptionTrack,
  observed: CaptionTrack,
  allowLanguageFallback: boolean,
): boolean {
  if (isSameCaptionTrack(selected, observed)) return true
  return allowLanguageFallback && (!selected.vssId || !observed.vssId) &&
    selected.languageCode.toLowerCase() === observed.languageCode.toLowerCase() &&
    selected.kind === observed.kind
}

export function clearObservedTimedtext(videoId?: string): void {
  if (videoId) {
    observedPayloads.delete(videoId)
    observedPotUrls.delete(videoId)
    return
  }
  observedPayloads.clear()
  observedPotUrls.clear()
}

// Extend XHR type for our custom property
declare global {
  interface XMLHttpRequest {
    __gistlateUrl?: string
  }
}
