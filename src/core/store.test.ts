import { describe, expect, it, vi } from 'vitest'
import { store } from './store'
import type { CacheEntry } from '../cache/l1'

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

  it('publishes optional complete artifact context and notifies on reset', () => {
    const artifact: CacheEntry = {
      key: 'video|ja|zh-Hans',
      videoId: 'video',
      src: 'ja',
      tgt: 'zh-Hans',
      model: 'model',
      cues: [{ s: 0, d: 1000, o: '原文', t: '译文' }],
      createdAt: 1,
    }
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setSubtitle('ja', artifact.cues, artifact)
    expect(store.subtitle?.artifact).toBe(artifact)
    store.reset()
    expect(store.subtitle).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(0)
    unsubscribe()
  })
})
