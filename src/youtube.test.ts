import { afterEach, describe, expect, it, vi } from 'vitest'

const pageWindow = vi.hoisted(() => ({
  document: undefined as Document | undefined,
  ytInitialPlayerResponse: undefined as
    | {
        videoDetails?: {
          videoId?: string
          title?: string
          shortDescription?: string
        }
      }
    | undefined,
  ytcfg: undefined as { get?: (key: string) => string | undefined } | undefined,
}))

vi.mock('$', () => ({ unsafeWindow: pageWindow }))

import { getPlayerCaptionData, getVideoContext, isTimedtextRequestForVideo } from './youtube'

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
  pageWindow.document = undefined
  pageWindow.ytInitialPlayerResponse = undefined
  pageWindow.ytcfg = undefined
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

describe('YouTube player caption data', () => {
  it('reads expando player methods from the page-world document', () => {
    installPlayerDocument({
      getPlayerResponse: () => ({ videoDetails: { videoId: 'isolated-world' } }),
    })
    pageWindow.document = {
      querySelector: (selector: string) => selector === '#movie_player'
        ? {
            getPlayerResponse: () => ({
              videoDetails: { videoId: 'current' },
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [{
                    baseUrl: '/api/timedtext?v=current&lang=en&vssId=.en',
                    languageCode: 'en',
                    vssId: '.en',
                  }],
                },
              },
            }),
            getPlayerState: () => 1,
          }
        : null,
    } as unknown as Document

    expect(getPlayerCaptionData('current')).toEqual(expect.objectContaining({
      videoId: 'current',
      playerState: 1,
      captionTracks: [expect.objectContaining({ vssId: '.en' })],
    }))
  })

  it('normalizes matching player tracks, selected identity, audio metadata and client params', () => {
    const player = {
      getPlayerResponse: () => ({
        videoDetails: { videoId: 'current', defaultAudioLanguage: 'ja' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: '/api/timedtext?v=current&lang=ja&vssId=.ja',
                languageCode: 'ja',
                vssId: '.ja',
                name: { simpleText: 'Japanese' },
              },
              {
                baseUrl: 'https://www.youtube.com/api/timedtext?v=current&lang=ja&kind=asr&vssId=a.ja',
                languageCode: 'ja',
                kind: 'asr',
                vssId: 'a.ja',
              },
            ],
          },
        },
      }),
      getOption: () => ({ languageCode: 'ja', vssId: '.ja' }),
      getAudioTrack: () => ({
        id: 'ja.4',
        captionTracks: [{
          url: 'https://www.youtube.com/api/timedtext?v=current&lang=ja&vssId=.ja&pot=token',
          vssId: '.ja',
        }],
      }),
      getPlayerState: () => 1,
      getWebPlayerContextConfig: () => ({ innertubeContextClientVersion: '2.20260718' }),
    }
    installPlayerDocument(player)
    pageWindow.ytcfg = { get: (key) => key === 'DEVICE' ? 'cbr=Chrome&cos=Windows' : undefined }

    expect(getPlayerCaptionData('current')).toEqual({
      videoId: 'current',
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=current&lang=ja&vssId=.ja',
          languageCode: 'ja',
          kind: 'manual',
          vssId: '.ja',
          name: 'Japanese',
          selected: true,
          audioLanguageMatch: true,
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=current&lang=ja&kind=asr&vssId=a.ja',
          languageCode: 'ja',
          kind: 'asr',
          vssId: 'a.ja',
          name: undefined,
          selected: false,
          audioLanguageMatch: true,
        },
      ],
      audioCaptionTracks: [{
        url: 'https://www.youtube.com/api/timedtext?v=current&lang=ja&vssId=.ja&pot=token',
        vssId: '.ja',
        languageCode: 'ja',
        kind: 'manual',
      }],
      audioLanguage: 'ja',
      playerState: 1,
      device: 'cbr=Chrome&cos=Windows',
      clientVersion: '2.20260718',
    })
  })

  it('rejects player data whose video ID does not match the expected Watch video', () => {
    installPlayerDocument({
      getPlayerResponse: () => ({ videoDetails: { videoId: 'previous' } }),
    })
    expect(getPlayerCaptionData('current')).toBeNull()
  })

  it('keeps usable caption inventory when optional player methods throw', () => {
    installPlayerDocument({
      getPlayerResponse: () => ({
        videoDetails: { videoId: 'current', defaultAudioLanguage: 'en' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{
              baseUrl: '/api/timedtext?v=current&lang=en&vssId=.en',
              languageCode: 'en',
              vssId: '.en',
            }],
          },
        },
      }),
      getOption: () => { throw new Error('captions module not ready') },
      getAudioTrack: () => { throw new Error('audio module not ready') },
      getPlayerState: () => { throw new Error('state unavailable') },
      getWebPlayerContextConfig: () => { throw new Error('context unavailable') },
    })
    pageWindow.ytcfg = { get: () => { throw new Error('config unavailable') } }

    expect(getPlayerCaptionData('current')).toEqual(expect.objectContaining({
      videoId: 'current',
      playerState: -1,
      audioLanguage: 'en',
      captionTracks: [expect.objectContaining({ vssId: '.en' })],
    }))
  })
})

function installPlayerDocument(player: object): void {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      title: '',
      querySelector: (selector: string) => selector === '#movie_player' ? player : null,
    } as unknown as Document,
  })
}
