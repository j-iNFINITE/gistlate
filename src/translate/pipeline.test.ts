import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { translateAllCues } from './pipeline'
import type { Cue } from '../subtitles/timedtext'

// Mock the transport so no real network happens.
vi.mock('../net/gm', () => ({
  gmFetch: vi.fn(),
}))

import { gmFetch } from '../net/gm'
const mockGmFetch = vi.mocked(gmFetch)

const OPENAI_CFG = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

const CUES: Cue[] = [
  { s: 0, d: 1000, o: 'Hello' },
  { s: 1000, d: 1000, o: 'World' },
  { s: 2000, d: 1000, o: 'Test' },
]

/** N cues with distinct originals (o = "L1".."LN"). */
function makeCues(n: number): Cue[] {
  return Array.from({ length: n }, (_, i) => ({ s: i * 1000, d: 1000, o: `L${i + 1}` }))
}

/** Build a /chat/completions success body. `finishReason` defaults to 'stop'. */
function chatOk(content: string, finishReason = 'stop') {
  return {
    status: 200,
    text: JSON.stringify({
      choices: [{ message: { content }, finish_reason: finishReason }],
    }),
  }
}

/** Numbered 1:1 response body ("[1] t1\n[2] t2..." with a shared prefix). */
function numbered(n: number, prefix = 't') {
  const content = Array.from({ length: n }, (_, i) => `[${i + 1}] ${prefix}${i + 1}`).join('\n')
  return chatOk(content)
}

// Fake timers keep the retry backoff (1s/2s) instant. Microtasks (promise
// resolution) are NOT faked, so mocked gmFetch responses still resolve.
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('translateAllCues (segment + translate, with 1:1 fallback)', () => {
  it('returns empty for empty cues without calling the API', async () => {
    const result = await translateAllCues([], 'es', OPENAI_CFG, 'sk-test')
    expect(result).toEqual([])
    expect(mockGmFetch).not.toHaveBeenCalled()
  })

  it('groups fragments into sentence-cues in a SINGLE request', async () => {
    // 3 fragments → 2 sentences (a merged pair + a single).
    mockGmFetch.mockResolvedValueOnce(chatOk('[1-2] Hola Mundo\n[3] Prueba'))

    const result = await translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2) // fewer cues than fragments
    expect(result[0]).toEqual({ s: 0, d: 2000, o: 'Hello World', t: 'Hola Mundo' })
    expect(result[1]).toEqual({ s: 2000, d: 1000, o: 'Test', t: 'Prueba' })
  })

  it('splits on truncation (finish_reason=length) and covers every fragment', async () => {
    const cues = makeCues(10) // > MIN_SPLIT (8), so the range is splittable
    mockGmFetch
      // whole range truncates → TruncationError → split into two halves of 5
      .mockResolvedValueOnce(chatOk('[1] partial', 'length'))
      .mockResolvedValueOnce(chatOk('[1-3] La\n[4-5] Lb')) // left half, fragments 1..5
      .mockResolvedValueOnce(chatOk('[1-2] Ra\n[3-5] Rb')) // right half, fragments 6..10

    const result = await translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(4) // 4 sentence-cues from 10 fragments
    expect(result.every((c) => c.t && c.t.trim() !== '')).toBe(true)
    // Contiguous, gap-free coverage of the whole 0..10_000ms span.
    expect(result[0]).toEqual({ s: 0, d: 3000, o: 'L1 L2 L3', t: 'La' })
    expect(result[1]).toEqual({ s: 3000, d: 2000, o: 'L4 L5', t: 'Lb' })
    expect(result[2]).toEqual({ s: 5000, d: 2000, o: 'L6 L7', t: 'Ra' })
    expect(result[3]).toEqual({ s: 7000, d: 3000, o: 'L8 L9 L10', t: 'Rb' })
  })

  it('falls back to 1:1 fragment translation when segmentation stays invalid', async () => {
    mockGmFetch
      // 3 segmentation attempts, each covers only fragment 1 of 3 → SegmentationError
      .mockResolvedValueOnce(chatOk('[1] bad'))
      .mockResolvedValueOnce(chatOk('[1] bad'))
      .mockResolvedValueOnce(chatOk('[1] bad'))
      // fallback 1:1 path (existing translateBatch) succeeds
      .mockResolvedValueOnce(chatOk('[1] Hola\n[2] Mundo\n[3] Prueba'))

    const p = translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test')
    await vi.runAllTimersAsync() // drive the segmentation retry backoff
    const result = await p

    expect(mockGmFetch).toHaveBeenCalledTimes(4)
    // Fragment-level cues (N of them), each with a translation, originals intact.
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.o)).toEqual(['Hello', 'World', 'Test'])
    expect(result.map((c) => c.t)).toEqual(['Hola', 'Mundo', 'Prueba'])
  })

  it('aborts cleanly mid-flight and does NOT fall back or write', async () => {
    const cues = makeCues(10)
    const ac = new AbortController()
    mockGmFetch.mockImplementationOnce(async () => {
      ac.abort()
      throw new Error('Translation aborted')
    })

    await expect(
      translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test', ac.signal),
    ).rejects.toThrow(/abort/i)
    // Aborted on the first request; no retry, no fallback.
    expect(mockGmFetch).toHaveBeenCalledTimes(1)
  })
})
