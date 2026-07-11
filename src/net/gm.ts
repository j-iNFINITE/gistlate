import { GM_xmlhttpRequest } from '$'

/** Lightweight Promise-wrapped GM_xmlhttpRequest with AbortSignal support. */
export function gmFetch(opts: {
  method: 'GET' | 'PUT' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const handle = GM_xmlhttpRequest({
      method: opts.method,
      url: opts.url,
      headers: opts.headers,
      data: opts.body,
      onload: (r) => resolve({ status: r.status, text: r.responseText }),
      onerror: (r) =>
        reject(
          new Error(
            `GM_xmlhttpRequest network error (status=${r?.status ?? 0}${
              r?.error ? `, ${r.error}` : ''
            }). Likely a Tampermonkey @connect permission block for ${hostOf(opts.url)} — ` +
              `check the Tampermonkey icon for a connection prompt and choose "Always allow".`,
          ),
        ),
      ontimeout: () => reject(new Error(`GM_xmlhttpRequest: timeout for ${hostOf(opts.url)}`)),
    })
    opts.signal?.addEventListener('abort', () => handle?.abort?.(), { once: true })
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
