import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageWindow = vi.hoisted(() => {
  const XMLHttpRequestCtor = function XMLHttpRequest() {} as unknown as typeof XMLHttpRequest
  XMLHttpRequestCtor.prototype.open = function () {}
  XMLHttpRequestCtor.prototype.send = function () {}
  return {
    fetch: vi.fn(),
    XMLHttpRequest: XMLHttpRequestCtor,
  }
})

vi.mock('$', () => ({ unsafeWindow: pageWindow }))

import {
  clearObservedTimedtext,
  getObservedPotUrl,
  getObservedTimedtext,
  interceptTimedtext,
  parseTimedtextUrl,
} from './netHook'

let cleanup: (() => void) | undefined

beforeEach(() => {
  clearObservedTimedtext()
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

describe('timedtext network observation', () => {
  it('recognizes YouTube timedtext URLs but rejects lookalike hosts and paths', () => {
    expect(parseTimedtextUrl('/api/timedtext?v=vid&lang=ja')?.searchParams.get('v')).toBe('vid')
    expect(parseTimedtextUrl('https://music.youtube.com/api/timedtext?v=vid')).not.toBeNull()
    expect(parseTimedtextUrl('https://example.com/api/timedtext?v=vid')).toBeNull()
    expect(parseTimedtextUrl('https://www.youtube.com/watch?v=vid')).toBeNull()
  })

  it('stages a JSON3 response with full track identity and preserves the response', async () => {
    pageWindow.fetch = vi.fn(async () => new Response(JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'こんにちは' }] }],
    }), { status: 200 }))
    const handler = vi.fn()
    cleanup = interceptTimedtext(handler)
    const url = 'https://www.youtube.com/api/timedtext?v=vid&lang=ja&kind=asr&vssId=a.ja'

    const response = await pageWindow.fetch(url)
    expect(await response.json()).toEqual({
      events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'こんにちは' }] }],
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))

    expect(getObservedTimedtext('vid')).toMatchObject({
      videoId: 'vid',
      track: { languageCode: 'ja', kind: 'asr', vssId: 'a.ja' },
    })
  })

  it('records POT from the request URL even when the response is not JSON', async () => {
    pageWindow.fetch = vi.fn(async () => new Response('not-json', { status: 200 }))
    cleanup = interceptTimedtext(vi.fn())
    const url = 'https://www.youtube.com/api/timedtext?v=vid&lang=ja&pot=token&potc=1'

    await pageWindow.fetch(url)
    expect(getObservedPotUrl('vid')).toBe(url)
  })

  it('allows a missing-vss observed URL only when the caller proved language/kind unique', async () => {
    pageWindow.fetch = vi.fn(async () => new Response(JSON.stringify({
      events: [{ tStartMs: 0, segs: [{ utf8: '字幕' }] }],
    }), { status: 200 }))
    cleanup = interceptTimedtext(vi.fn())
    await pageWindow.fetch('https://www.youtube.com/api/timedtext?v=vid&lang=ja&kind=asr')
    await vi.waitFor(() => expect(getObservedTimedtext('vid')).toBeDefined())
    const selected = {
      baseUrl: 'https://www.youtube.com/api/timedtext?v=vid&lang=ja',
      languageCode: 'ja',
      kind: 'asr' as const,
      vssId: 'a.ja',
    }

    expect(getObservedTimedtext('vid', selected)).toBeUndefined()
    expect(getObservedTimedtext('vid', selected, true)).toBeDefined()
  })

  it('never stages YouTube auto-translated tlang responses as source tracks', async () => {
    pageWindow.fetch = vi.fn(async () => new Response(JSON.stringify({
      events: [{ tStartMs: 0, segs: [{ utf8: '翻译' }] }],
    }), { status: 200 }))
    cleanup = interceptTimedtext(vi.fn())

    await pageWindow.fetch(
      'https://www.youtube.com/api/timedtext?v=vid&lang=ja&tlang=zh-CN',
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(getObservedTimedtext('vid')).toBeUndefined()
  })

  it('does not stage empty or malformed JSON3 responses', async () => {
    pageWindow.fetch = vi.fn(async () => new Response(JSON.stringify({ events: [] }), {
      status: 200,
    }))
    const handler = vi.fn()
    cleanup = interceptTimedtext(handler)

    await pageWindow.fetch('https://www.youtube.com/api/timedtext?v=vid&lang=ja')
    await Promise.resolve()
    await Promise.resolve()

    expect(handler).not.toHaveBeenCalled()
    expect(getObservedTimedtext('vid')).toBeUndefined()
  })
})
