import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readL2, writeL2 } from './l2github'

vi.mock('../net/gm', () => ({
  gmFetch: vi.fn(),
}))

import { gmFetch } from '../net/gm'
const mockGmFetch = vi.mocked(gmFetch)

const CFG = { owner: 'testuser', repo: 'pool', branch: 'main' }
const KEY_INPUT = { videoId: 'abc123xyz', src: 'en', tgt: 'zh-Hans' }
const ENTRY = {
  key: 'abc123xyz|en|zh-Hans',
  videoId: 'abc123xyz',
  src: 'en',
  tgt: 'zh-Hans',
  model: 'gpt-4o-mini',
  cues: [{ s: 0, d: 1000, o: 'Hello', t: '你好' }],
  createdAt: 1700000000000,
}

describe('readL2', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed entry on 200', async () => {
    mockGmFetch.mockResolvedValueOnce({ status: 200, text: JSON.stringify(ENTRY) })
    const result = await readL2(CFG, KEY_INPUT)
    expect(result).toEqual(ENTRY)
    expect(mockGmFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: expect.stringContaining('raw.githubusercontent.com/testuser/pool/main/data/ab'),
      }),
    )
  })

  it('returns undefined on 404', async () => {
    mockGmFetch.mockResolvedValueOnce({ status: 404, text: 'Not Found' })
    const result = await readL2(CFG, KEY_INPUT)
    expect(result).toBeUndefined()
  })

  it('returns undefined on network error', async () => {
    mockGmFetch.mockRejectedValueOnce(new Error('Network'))
    const result = await readL2(CFG, KEY_INPUT)
    expect(result).toBeUndefined()
  })

  it('returns undefined when owner is empty', async () => {
    const result = await readL2({ owner: '', repo: '', branch: 'main' }, KEY_INPUT)
    expect(result).toBeUndefined()
    expect(mockGmFetch).not.toHaveBeenCalled()
  })
})

describe('writeL2', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes a new file (no sha)', async () => {
    // GET /contents → 404
    mockGmFetch.mockResolvedValueOnce({ status: 404, text: 'Not Found' })
    // PUT /contents → 201
    mockGmFetch.mockResolvedValueOnce({ status: 201, text: '{"content":{}}' })

    await writeL2(CFG, 'ghp_test123', ENTRY)

    // First call: get current sha
    expect(mockGmFetch.mock.calls[0][0].method).toBe('GET')
    expect(mockGmFetch.mock.calls[0][0].url).toContain('api.github.com')

    // Second call: PUT without sha
    const putCall = mockGmFetch.mock.calls[1][0]
    expect(putCall.method).toBe('PUT')
    const body = JSON.parse(putCall.body!)
    expect(body.sha).toBeUndefined()
    expect(body.message).toContain('abc123xyz')
    expect(body.branch).toBe('main')
  })

  it('updates an existing file (with sha)', async () => {
    // GET /contents → 200 with sha
    mockGmFetch.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ sha: 'abc123def' }),
    })
    // PUT /contents → 200
    mockGmFetch.mockResolvedValueOnce({ status: 200, text: '{"content":{}}' })

    await writeL2(CFG, 'ghp_test123', ENTRY)

    const putCall = mockGmFetch.mock.calls[1][0]
    const body = JSON.parse(putCall.body!)
    expect(body.sha).toBe('abc123def')
  })

  it('skips write if missing PAT or config', async () => {
    await writeL2({ owner: '', repo: '', branch: 'main' }, '', ENTRY)
    expect(mockGmFetch).not.toHaveBeenCalled()

    await writeL2(CFG, '', ENTRY)
    expect(mockGmFetch).not.toHaveBeenCalled()
  })

  it('soft-fails on PUT error (does not throw)', async () => {
    // GET /contents → 200 with sha
    mockGmFetch.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ sha: 'abc123def' }),
    })
    // PUT /contents → 422
    mockGmFetch.mockRejectedValueOnce(new Error('API Error'))

    // Should not throw
    await expect(writeL2(CFG, 'ghp_test123', ENTRY)).resolves.toBeUndefined()
  })
})
