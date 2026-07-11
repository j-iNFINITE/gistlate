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

/** Numbered response body ("[1] t1\n[2] t2..." with a shared prefix) for `n` lines. */
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

describe('translateAllCues (one-shot + adaptive fallback)', () => {
  it('translates the whole cue list in a SINGLE request', async () => {
    mockGmFetch.mockResolvedValueOnce(chatOk('[1] Hola\n[2] Mundo\n[3] Prueba'))

    const result = await translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.t)).toEqual(['Hola', 'Mundo', 'Prueba'])
  })

  it('returns empty for empty cues without calling the API', async () => {
    const result = await translateAllCues([], 'es', OPENAI_CFG, 'sk-test')
    expect(result).toEqual([])
    expect(mockGmFetch).not.toHaveBeenCalled()
  })

  it('splits on truncation (finish_reason=length) and completes the full track', async () => {
    const cues = makeCues(10) // > MIN_SPLIT (8), so the range is splittable
    mockGmFetch
      // whole range truncates → TruncationError → split into two halves of 5
      .mockResolvedValueOnce(chatOk('[1] partial', 'length'))
      .mockResolvedValueOnce(numbered(5, 'a')) // left half [1..5]
      .mockResolvedValueOnce(numbered(5, 'b')) // right half [6..10]

    const result = await translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(10)
    expect(result.every((c) => c.t && c.t.trim() !== '')).toBe(true)
    expect(result[0].t).toBe('a1')
    expect(result[4].t).toBe('a5')
    expect(result[5].t).toBe('b1')
    expect(result[9].t).toBe('b5')
  })

  it('recurses again when a half also truncates', async () => {
    const cues = makeCues(20) // 20 → 10 + 10; left 10 truncates → 5 + 5
    mockGmFetch
      .mockResolvedValueOnce(chatOk('[1] partial', 'length')) // whole 20 truncates
      .mockResolvedValueOnce(chatOk('[1] partial', 'length')) // left 10 truncates
      .mockResolvedValueOnce(numbered(5, 'a')) // left-left [1..5]
      .mockResolvedValueOnce(numbered(5, 'b')) // left-right [6..10]
      .mockResolvedValueOnce(numbered(10, 'c')) // right 10 [11..20]

    const result = await translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(5)
    expect(result).toHaveLength(20)
    expect(result.every((c) => c.t && c.t.trim() !== '')).toBe(true)
    expect(result[0].t).toBe('a1')
    expect(result[10].t).toBe('c1')
    expect(result[19].t).toBe('c10')
  })

  it('throws on persistent count mismatch below the split floor (fail-closed, no partial)', async () => {
    // 3 cues (< MIN_SPLIT): never splits; retries in place then throws.
    // Permanent bad response: missing slot [2] on every attempt.
    mockGmFetch.mockResolvedValue(chatOk('[1] Hola\n[3] Prueba'))

    const p = translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test')
    const expectation = expect(p).rejects.toThrow(/mismatch|missing/i)
    await vi.runAllTimersAsync() // drive the retry backoff
    await expectation
  })

  it('does NOT split a range at the MIN_SPLIT floor (bounded, no infinite loop)', async () => {
    const cues = makeCues(8) // == MIN_SPLIT → not splittable
    mockGmFetch.mockResolvedValue(chatOk('[1] only', 'length')) // always truncates

    await expect(translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test')).rejects.toThrow(
      /truncat/i,
    )
    // Truncation fails fast (no retry); floor blocks the split → exactly one call.
    expect(mockGmFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT split a non-splittable (network) error; retries in place then throws', async () => {
    const cues = makeCues(10) // > MIN_SPLIT, but the error is not splittable
    mockGmFetch.mockRejectedValue(new Error('Network error'))

    const p = translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test')
    const expectation = expect(p).rejects.toThrow('Network error')
    await vi.runAllTimersAsync()
    await expectation
    // 3 retry attempts on the whole range, never split.
    expect(mockGmFetch).toHaveBeenCalledTimes(3)
  })

  it('aborts cleanly mid-flight and writes nothing', async () => {
    const cues = makeCues(10)
    const ac = new AbortController()
    mockGmFetch.mockImplementationOnce(async () => {
      ac.abort()
      throw new Error('Translation aborted')
    })

    await expect(
      translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test', ac.signal),
    ).rejects.toThrow(/abort/i)
    // Aborted on the first request; recursion unwinds without further calls.
    expect(mockGmFetch).toHaveBeenCalledTimes(1)
  })
})
