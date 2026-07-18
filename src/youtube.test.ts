import { afterEach, describe, expect, it, vi } from 'vitest'

const pageWindow = vi.hoisted(() => ({
  ytInitialPlayerResponse: undefined as
    | {
        videoDetails?: {
          videoId?: string
          title?: string
          shortDescription?: string
        }
      }
    | undefined,
}))

vi.mock('$', () => ({ unsafeWindow: pageWindow }))

import { getVideoContext, isTimedtextRequestForVideo } from './youtube'

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

function installDocument(
  metadata: Record<string, string>,
  title = 'Fallback title - YouTube',
): void {
  const querySelector = vi.fn((selector: string) =>
    metadata[selector] ? { content: metadata[selector] } : null,
  )
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { title, querySelector } as unknown as Document,
  })
}

afterEach(() => {
  pageWindow.ytInitialPlayerResponse = undefined
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument)
  } else {
    delete (globalThis as { document?: Document }).document
  }
})

describe('getVideoContext', () => {
  it('prefers matching player-response metadata and normalizes it', () => {
    pageWindow.ytInitialPlayerResponse = {
      videoDetails: {
        videoId: 'current',
        title: '  Current\n title ',
        shortDescription: ' Current\t description ',
      },
    }
    installDocument({
      'meta[itemprop="name"]': 'DOM title',
      'meta[itemprop="description"]': 'DOM description',
    })

    expect(getVideoContext('current')).toEqual({
      title: 'Current title',
      description: 'Current description',
    })
  })

  it('rejects stale player-response metadata and falls back to current DOM metadata', () => {
    pageWindow.ytInitialPlayerResponse = {
      videoDetails: {
        videoId: 'previous',
        title: 'Stale title',
        shortDescription: 'Stale description',
      },
    }
    installDocument({
      'meta[property="og:title"]': 'Current DOM title',
      'meta[name="description"]': 'Current DOM description',
    })

    expect(getVideoContext('current')).toEqual({
      title: 'Current DOM title',
      description: 'Current DOM description',
    })
  })

  it('uses a cleaned document title and tolerates a missing description', () => {
    installDocument({}, 'Document fallback - YouTube')

    expect(getVideoContext('current')).toEqual({ title: 'Document fallback' })
  })
})

describe('timedtext video identity', () => {
  it('accepts only a request whose v parameter matches the current watch video', () => {
    expect(isTimedtextRequestForVideo(new URLSearchParams('v=current&lang=ja'), 'current')).toBe(true)
    expect(isTimedtextRequestForVideo(new URLSearchParams('v=previous&lang=ja'), 'current')).toBe(false)
    expect(isTimedtextRequestForVideo(new URLSearchParams('lang=ja'), 'current')).toBe(false)
    expect(isTimedtextRequestForVideo(new URLSearchParams('v=current'), null)).toBe(false)
  })
})
