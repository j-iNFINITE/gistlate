import { describe, expect, it, vi } from 'vitest'
import { store } from './store'

describe('Store subtitle observability', () => {
  it('notifies current-time subscribers when progressive cues replace subtitles', () => {
    store.reset()
    store.setCurrentTime(1250)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setSubtitle('ja', [{ s: 0, d: 2000, o: '原文', t: '译文' }])
    expect(listener).toHaveBeenCalledWith(1250)
    unsubscribe()
    store.reset()
  })
})
