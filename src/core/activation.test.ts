import { describe, expect, it } from 'vitest'
import { deactivatedVideoId, shouldAutoStartVideo } from './activation'

describe('current-video activation policy', () => {
  it('auto-starts a new Watch video only when enabled', () => {
    expect(shouldAutoStartVideo({
      videoId: 'new', autoStart: true, activeVideoId: null, suppressedVideoId: null,
    })).toBe(true)
    expect(shouldAutoStartVideo({
      videoId: 'new', autoStart: false, activeVideoId: null, suppressedVideoId: null,
    })).toBe(false)
  })

  it('does not restart an active or manually suppressed current video', () => {
    expect(shouldAutoStartVideo({
      videoId: 'same', autoStart: true, activeVideoId: 'same', suppressedVideoId: null,
    })).toBe(false)
    expect(shouldAutoStartVideo({
      videoId: 'same', autoStart: true, activeVideoId: null, suppressedVideoId: 'same',
    })).toBe(false)
  })

  it('allows the next different video after a current-video suppression', () => {
    expect(shouldAutoStartVideo({
      videoId: 'next', autoStart: true, activeVideoId: null, suppressedVideoId: 'previous',
    })).toBe(true)
    expect(shouldAutoStartVideo({
      videoId: null, autoStart: true, activeVideoId: null, suppressedVideoId: null,
    })).toBe(false)
  })
})

describe('current-video cleanup identity', () => {
  it('clears the previous page on inactive SPA navigation, not the new URL', () => {
    expect(deactivatedVideoId({
      reason: 'navigation',
      activeVideoId: null,
      trackVideoId: null,
      currentVideoId: 'new-video',
      previousPageVideoId: 'old-video',
    })).toBe('old-video')
  })

  it('prefers the active/captured session and uses the current URL for user stops', () => {
    expect(deactivatedVideoId({
      reason: 'navigation',
      activeVideoId: 'active-video',
      trackVideoId: 'captured-video',
      currentVideoId: 'new-video',
      previousPageVideoId: 'old-video',
    })).toBe('active-video')
    expect(deactivatedVideoId({
      reason: 'user',
      activeVideoId: null,
      trackVideoId: null,
      currentVideoId: 'current-video',
      previousPageVideoId: null,
    })).toBe('current-video')
  })
})
