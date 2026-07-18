import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearL1, getL1, listL1, putL1, type CacheEntry } from './l1'

function entry(key: string, createdAt: number): CacheEntry {
  return {
    key,
    videoId: key,
    src: 'ja',
    tgt: 'zh-Hans',
    model: 'deepseek-v4-flash',
    cues: [{ s: 0, d: 1000, o: '原文', t: '译文' }],
    createdAt,
  }
}

describe('local subtitle library', () => {
  beforeEach(async () => clearL1())

  it('lists local artifacts newest-first without requiring optional metadata', async () => {
    const now = Date.now()
    await putL1(entry('oldest', now - 3000))
    await putL1(entry('newest', now - 1000))
    await putL1(entry('middle', now - 2000))

    expect((await listL1()).map((item) => item.key)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('prunes entries older than the existing 90-day cache policy', async () => {
    const expired = entry('expired', Date.now() - 91 * 24 * 60 * 60 * 1000)
    await putL1(expired)
    await putL1(entry('fresh', Date.now()))

    expect((await listL1()).map((item) => item.key)).toEqual(['fresh'])
    expect(await getL1('expired')).toBeUndefined()
  })
})
