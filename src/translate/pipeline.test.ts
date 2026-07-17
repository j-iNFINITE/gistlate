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

/** Pass-1 boundary body: `flags` like 'CEE' → "[1] C\n[2] E\n[3] E". */
function boundaryResp(flags: string) {
  const content = flags
    .split('')
    .map((f, i) => `[${i + 1}] ${f}`)
    .join('\n')
  return chatOk(content)
}

/** Pass-2 / fallback body: numbered 1:1 from explicit labels ("[1] a\n[2] b"). */
function numberedLabels(labels: string[]) {
  return chatOk(labels.map((l, i) => `[${i + 1}] ${l}`).join('\n'))
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

describe('translateAllCues (two-pass: boundaries + sentence translation, with 1:1 fallback)', () => {
  it('returns empty for empty cues without calling the API', async () => {
    const result = await translateAllCues([], 'es', OPENAI_CFG, 'sk-test')
    expect(result).toEqual([])
    expect(mockGmFetch).not.toHaveBeenCalled()
  })

  it('detects boundaries then translates whole sentences in TWO requests', async () => {
    // Pass 1: fragments 1+2 form one sentence, fragment 3 another.
    // Pass 2: translate the two joined sentences 1:1.
    mockGmFetch
      .mockResolvedValueOnce(boundaryResp('CEE'))
      .mockResolvedValueOnce(numberedLabels(['Hola Mundo', 'Prueba']))

    const result = await translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2) // fewer cues than fragments

    // Sentence 0 end is clamped to the next sentence's start (2000) → d = 2000.
    expect(result[0]).toEqual({ s: 0, d: 2000, o: 'Hello World', t: 'Hola Mundo' })
    // Last sentence: raw end 2000 + 1000 = 3000 → d = 1000.
    expect(result[1]).toEqual({ s: 2000, d: 1000, o: 'Test', t: 'Prueba' })
  })

  it('caps one long detected sentence before pass 2 and keeps video context', async () => {
    const cues = makeCues(20)
    mockGmFetch
      .mockResolvedValueOnce(boundaryResp(`${'C'.repeat(19)}E`))
      .mockResolvedValueOnce(numberedLabels(['Primera parte', 'Segunda parte']))

    const result = await translateAllCues(
      cues,
      'es',
      OPENAI_CFG,
      'sk-test',
      undefined,
      { title: 'A long lesson', description: 'One continuous explanation.' },
    )

    expect(result).toHaveLength(2)
    expect(result[0].o).toBe(makeCues(15).map((cue) => cue.o).join(' '))
    expect(result[0].s).toBe(0)
    expect(result[0].d).toBe(15000)
    expect(result[0].t).toBe('Primera parte')
    expect(result[1].o).toBe('L16 L17 L18 L19 L20')
    expect(result[1].s).toBe(15000)
    expect(result[1].t).toBe('Segunda parte')

    const boundaryBody = JSON.parse(mockGmFetch.mock.calls[0]![0].body as string)
    const translationBody = JSON.parse(mockGmFetch.mock.calls[1]![0].body as string)
    expect(boundaryBody.messages[1].content).not.toContain('A long lesson')
    expect(translationBody.messages[1].content).toContain('A long lesson')
    expect(translationBody.messages[1].content).toContain('[2] L16 L17 L18 L19 L20')
  })

  it('splits the pass-2 translation on truncation and still covers every sentence', async () => {
    const cues = makeCues(10) // 10 fragments → 10 sentences > MIN_SPLIT (8)
    mockGmFetch
      // Pass 1: every fragment ends its own sentence.
      .mockResolvedValueOnce(boundaryResp('E'.repeat(10)))
      // Pass 2 whole range truncates → TruncationError → split into halves of 5.
      .mockResolvedValueOnce(chatOk('[1] partial', 'length'))
      .mockResolvedValueOnce(numberedLabels(['T1', 'T2', 'T3', 'T4', 'T5'])) // left 1..5
      .mockResolvedValueOnce(numberedLabels(['T6', 'T7', 'T8', 'T9', 'T10'])) // right 6..10

    const result = await translateAllCues(cues, 'es', OPENAI_CFG, 'sk-test')

    expect(mockGmFetch).toHaveBeenCalledTimes(4)
    expect(result).toHaveLength(10) // one sentence-cue per fragment
    expect(result.every((c) => c.t && c.t.trim() !== '')).toBe(true)
    // Contiguous, gap-free spans (each non-last clamped to the next start).
    expect(result[0]).toEqual({ s: 0, d: 1000, o: 'L1', t: 'T1' })
    expect(result[9]).toEqual({ s: 9000, d: 1000, o: 'L10', t: 'T10' })
  })

  it('falls back to 1:1 fragment translation when pass-1 boundaries stay malformed', async () => {
    mockGmFetch
      // 3 boundary attempts (initial + 2 retries): each omits fragments 2,3 → SegmentationError.
      .mockResolvedValueOnce(chatOk('[1] E'))
      .mockResolvedValueOnce(chatOk('[1] E'))
      .mockResolvedValueOnce(chatOk('[1] E'))
      // Fallback 1:1 path (existing translateBatch) succeeds.
      .mockResolvedValueOnce(numberedLabels(['Hola', 'Mundo', 'Prueba']))

    const p = translateAllCues(CUES, 'es', OPENAI_CFG, 'sk-test')
    await vi.runAllTimersAsync() // drive the pass-1 retry backoff
    const result = await p

    expect(mockGmFetch).toHaveBeenCalledTimes(4)
    // The first request WAS the boundary (pass-1) request.
    const firstBody = JSON.parse(mockGmFetch.mock.calls[0]![0].body as string)
    expect(firstBody.messages[0].content).toContain('[<n>] E')

    // Fragment-level cues (N of them), each translated, originals intact.
    expect(result).toHaveLength(3)
    expect(result.map((c) => c.o)).toEqual(['Hello', 'World', 'Test'])
    expect(result.map((c) => c.t)).toEqual(['Hola', 'Mundo', 'Prueba'])
  })

  it('aborts cleanly during pass 1 and does NOT fall back or write', async () => {
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
