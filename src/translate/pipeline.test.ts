import { describe, it, expect, vi, beforeEach } from 'vitest'
import { translateAllCues } from './pipeline'
import type { Cue } from '../subtitles/timedtext'

// Mock gmFetch
vi.mock('../net/gm', () => ({
  gmFetch: vi.fn(),
}))

import { gmFetch } from '../net/gm'
const mockGmFetch = vi.mocked(gmFetch)

const CUES: Cue[] = [
  { s: 0, d: 1000, o: 'Hello' },
  { s: 1000, d: 1000, o: 'World' },
  { s: 2000, d: 1000, o: 'Test' },
]

const OPENAI_CFG = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

describe('translateAllCues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('translates all cues in one batch', async () => {
    mockGmFetch.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: '[1] Hola\n[2] Mundo\n[3] Prueba' } }],
      }),
    })

    const result = await translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test', 10)
    expect(result).toHaveLength(3)
    expect(result[0].t).toBe('Hola')
    expect(result[1].t).toBe('Mundo')
    expect(result[2].t).toBe('Prueba')
  })

  it('splits batches and merges results', async () => {
    mockGmFetch
      .mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: '[1] Hola\n[2] Mundo' } }],
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: '[1] Prueba' } }],
        }),
      })

    const result = await translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test', 2)
    expect(result).toHaveLength(3)
    expect(result[0].t).toBe('Hola')
    expect(result[2].t).toBe('Prueba')
  })

  it('throws on API error after retries', async () => {
    mockGmFetch.mockRejectedValue(new Error('Network error'))

    await expect(
      translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test'),
    ).rejects.toThrow('Network error')
  }, 15000)

  it('throws on empty translation slot', async () => {
    // Permanent mock: retry attempts will also get the same bad response
    mockGmFetch.mockResolvedValue({
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: '[1] Hola\n[3] Prueba' } }],
      }),
    })

    await expect(
      translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test'),
    ).rejects.toThrow(/missing.*\[2\]/)
  }, 15000)

  it('returns empty for empty cues', async () => {
    const result = await translateAllCues([], 'es', OPENAI_CFG, 'sk-test')
    expect(result).toEqual([])
    expect(mockGmFetch).not.toHaveBeenCalled()
  })

  it('respects abort signal mid-flight', async () => {
    const ac = new AbortController()
    mockGmFetch.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { content: '[1] Hola' } }],
      }),
    })
    // Second batch: reject on abort
    mockGmFetch.mockImplementationOnce(async () => {
      ac.abort()
      throw new Error('Translation aborted')
    })

    // Override CUES to be larger than batchSize=1 so we get 3 batches
    const bigCues = [
      { s: 0, d: 1000, o: 'Hello' },
      { s: 1000, d: 1000, o: 'World' },
    ]
    await expect(
      translateAllCues(bigCues, 'es', OPENAI_CFG, 'sk-test', 1, 1, ac.signal),
    ).rejects.toThrow(/aborted/)
  })
})
