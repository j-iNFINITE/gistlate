import { GM_xmlhttpRequest } from '$'

/** Lightweight Promise-wrapped GM_xmlhttpRequest with AbortSignal support. */
export function gmFetch(opts: {
  method: 'GET' | 'PUT' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'))
      return
    }
    let abortHandler: (() => void) | undefined
    const cleanup = () => {
      if (abortHandler) opts.signal?.removeEventListener('abort', abortHandler)
    }
    const handle = GM_xmlhttpRequest({
      method: opts.method,
      url: opts.url,
      headers: opts.headers,
      data: opts.body,
      timeout: opts.timeoutMs,
      onload: (r) => {
        cleanup()
        resolve({ status: r.status, text: r.responseText })
      },
      onerror: (r) => {
        cleanup()
        reject(
          new Error(
            `GM_xmlhttpRequest network error (status=${r?.status ?? 0}${
              r?.error ? `, ${r.error}` : ''
            }). Likely a Tampermonkey @connect permission block for ${hostOf(opts.url)} — ` +
              `check the Tampermonkey icon for a connection prompt and choose "Always allow".`,
          ),
        )
      },
      ontimeout: () => {
        cleanup()
        reject(new Error(`GM_xmlhttpRequest: timeout for ${hostOf(opts.url)}`))
      },
    })
    abortHandler = () => {
      handle?.abort?.()
      cleanup()
      reject(new DOMException('Request aborted', 'AbortError'))
    }
    opts.signal?.addEventListener('abort', abortHandler, { once: true })
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
