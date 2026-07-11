import { describe, it, expect } from 'vitest'
import { cacheKey, shard, repoPath } from './key'

describe('cacheKey', () => {
  it('combines videoId, src, tgt with pipe separator', () => {
    expect(cacheKey({ videoId: 'abc123', src: 'en', tgt: 'zh-Hans' })).toBe('abc123|en|zh-Hans')
  })
})

describe('shard', () => {
  it('returns first 2 chars', () => {
    expect(shard('abc123')).toBe('ab')
    expect(shard('x')).toBe('x')
  })
})

describe('repoPath', () => {
  it('builds the full repo path with shard', () => {
    const path = repoPath({ videoId: 'abc123xyz', src: 'en', tgt: 'zh-Hans' })
    expect(path).toBe('data/ab/abc123xyz.en-zh-Hans.json')
  })
})
