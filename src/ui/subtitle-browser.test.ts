import { describe, expect, it, vi } from 'vitest'
import type { CacheEntry } from '../cache/l1'

vi.mock('../settings', () => ({ loadSettings: vi.fn(() => ({ tgt: 'zh-Hans' })) }))

import { canSeekArtifact, describeArtifact } from './subtitle-browser'

function entry(): CacheEntry {
  return {
    key: 'video|ja|zh-Hans',
    videoId: 'video',
    src: 'ja',
    tgt: 'zh-Hans',
    model: 'deepseek-v4-flash',
    cues: [{ s: 0, d: 1000, o: '原文', t: '译文' }],
    createdAt: 1000,
    video: { title: '模型视频' },
    generation: {
      strategy: {
        mode: 'batch',
        configuredBatchSize: 8,
        effectiveRequestCount: 3,
        concurrency: 8,
        temperature: 0,
        boundaryMethod: 'timed-punctuation',
        boundaryRequestCount: 0,
        boundaryThinking: 'not-used',
        translationThinking: 'disabled',
      },
      alignment: { requestCount: 1, fallbackSentenceCount: 0 },
      usage: {
        requestCount: 4,
        usageResponseCount: 4,
        incompleteFields: [],
        tokens: {
          promptCacheHitTokens: 100,
          promptCacheMissTokens: 20,
          completionTokens: 30,
        },
        stages: {
          boundary: { requestCount: 0, usageResponseCount: 0, incompleteFields: [], tokens: {} },
          translation: { requestCount: 3, usageResponseCount: 3, incompleteFields: [], tokens: {} },
          alignment: { requestCount: 1, usageResponseCount: 1, incompleteFields: [], tokens: {} },
        },
      },
      costCny: 0.000182,
    },
  }
}

describe('subtitle browser projections', () => {
  it('renders optional artifact strategy, usage and measured cost', () => {
    const value = describeArtifact(entry())
    expect(value).toMatchObject({
      title: '模型视频',
      identity: 'video · ja → zh-Hans · 1 条',
    })
    expect(value.details.join(' ')).toContain('分批')
    expect(value.details.join(' ')).toContain('命中 100')
    expect(value.details.join(' ')).toContain('实际费用 ¥0.000182 CNY')
  })

  it('falls back safely for old artifacts without optional metadata', () => {
    const legacy = entry()
    delete legacy.video
    delete legacy.generation
    expect(describeArtifact(legacy)).toMatchObject({
      title: 'video',
      identity: 'video · ja → zh-Hans · 1 条',
    })
  })

  it('allows seeking only when the opened artifact belongs to the current video', () => {
    expect(canSeekArtifact('video', 'video')).toBe(true)
    expect(canSeekArtifact('other', 'video')).toBe(false)
    expect(canSeekArtifact('video', null)).toBe(false)
  })
})
