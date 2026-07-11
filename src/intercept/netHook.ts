import { unsafeWindow } from '$'
import type { GetTimedtextResp } from '../subtitles/timedtext'

/**
 * Minimal, dependency-free fetch + XHR interceptor.
 * Patches `unsafeWindow.fetch` and `XMLHttpRequest` to emit parsed timedtext
 * responses *without* modifying the response stream (observe-only).
 *
 * This is a clean-room implementation inspired by the *idea* from bilingualtube.
 * No code is copied from that project.
 */

export type TimedtextHandler = (payload: {
  url: string
  json: GetTimedtextResp
  params: URLSearchParams
}) => void

let registeredHandler: TimedtextHandler | null = null

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
    const res = await of(input, init)
    const url = requestUrl(input)
    if (url && isTimedtextUrl(url)) {
      res
        .clone()
        .json()
        .then((json: GetTimedtextResp) => {
          if (json?.events) emit(url, json)
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
    return originalOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest['open']>)
  }

  OXHR.prototype.send = function (
    this: XMLHttpRequest,
    ...args: unknown[]
  ): void {
    const url = this.__gistlateUrl
    if (url && isTimedtextUrl(url)) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState === 4) {
          try {
            const json: GetTimedtextResp = JSON.parse(this.responseText)
            if (json?.events) emit(url, json)
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

function isTimedtextUrl(url: string): boolean {
  return url.startsWith('https://www.youtube.com/api/timedtext')
}

/** Extract the URL string from a fetch `input` without consuming it. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

let pendingEmit: string | null = null

function emit(url: string, json: GetTimedtextResp): void {
  if (!registeredHandler) return
  // Dedup: skip if the same (videoId, lang) was already emitted in this tick
  const params = new URL(url).searchParams
  const vidKey = `${params.get('v') ?? ''}|${params.get('lang') ?? ''}`
  // Store ID to avoid double-firing for XHR + fetch on the same request
  if (pendingEmit === vidKey) return
  pendingEmit = vidKey
  queueMicrotask(() => {
    pendingEmit = null
  })
  registeredHandler({ url, json, params })
}

// Extend XHR type for our custom property
declare global {
  interface XMLHttpRequest {
    __gistlateUrl?: string
  }
}
