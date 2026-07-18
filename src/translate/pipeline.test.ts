import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '../subtitles/timedtext'
import { translateCues } from './pipeline'

vi.mock('../net/gm', () => ({ gmFetch: vi.fn() }))
import { gmFetch } from '../net/gm'
const mockGmFetch = vi.mocked(gmFetch)

const CFG = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }

function makeCues(count: number): Cue[] {
  return Array.from({ length: count }, (_, index) => ({
    s: index * 1000,
    d: 1000,
    o: `L${index + 1}`,
  }))
}

function chatOk(content: string, usage?: Record<string, unknown>) {
  return {
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
  }
}

function boundaries(flags: string) {
  return chatOk(flags.split('').map((flag, index) => `[${index + 1}] ${flag}`).join('\n'))
}

function targetIds(body: string): string[] {
  const parsed = JSON.parse(body) as { messages: Array<{ content: string }> }
  const match = parsed.messages[1].content.match(/TARGET IDS: ([^\n]+)/u)
  return match?.[1].split(',').map((id) => id.trim()) ?? []
}

function translations(ids: string[]) {
  return chatOk(ids.map((id) => `[${id}] T-${id}`).join('\n'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGmFetch.mockReset()
  vi.useFakeTimers()
})

afterEach(() => vi.useRealTimers())

describe('complete-sentence translation pipeline', () => {
  it('returns empty without making a request', async () => {
    const result = await translateCues([], 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
    })
    expect(result.cues).toEqual([])
    expect(mockGmFetch).not.toHaveBeenCalled()
  })

  it('uses deterministic ASR sentence-end hints without a boundary API request', async () => {
    const cues: Cue[] = [
      { s: 0, d: 1000, o: 'こんにちは。', sentenceEnd: true },
      { s: 1000, d: 1000, o: '模型です。', sentenceEnd: true },
    ]
    mockGmFetch.mockImplementation(async (request) => translations(targetIds(request.body as string)))
    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
    })
    expect(mockGmFetch).toHaveBeenCalledTimes(2)
    expect(mockGmFetch.mock.calls.every(([request]) => !(request.body as string).includes('[<n>] E'))).toBe(true)
    expect(result.cues.map((cue) => cue.t)).toEqual(['T-S001', 'T-S002'])
    expect(result.diagnostics).toEqual(expect.objectContaining({
      boundaryMethod: 'timed-punctuation',
      boundaryRequestCount: 0,
    }))
  })

  it('trusts manual YouTube cue boundaries and only translates each cue', async () => {
    const cues: Cue[] = [
      { s: 0, d: 1000, o: 'A manually authored line.' },
      // Manual cues are trusted even when the text exceeds ASR false-sentence
      // safety limits; no reliable timing exists for splitting inside the cue.
      { s: 1000, d: 35_000, o: 'B'.repeat(260) },
    ]
    mockGmFetch.mockImplementation(async (request) => {
      const ids = targetIds(request.body as string)
      return chatOk(ids.map((id) =>
        `[${id}] ${id === 'S002' ? '中'.repeat(260) : '人工字幕。'}`,
      ).join('\n'))
    })

    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      sourceKind: 'manual',
      translation: { mode: 'sentence', batchSize: 8 },
    })

    expect(mockGmFetch).toHaveBeenCalledTimes(2)
    expect(mockGmFetch.mock.calls.every(([request]) =>
      !(request.body as string).includes('[<n>] E'),
    )).toBe(true)
    expect(result.cues.map((cue) => cue.t)).toEqual(['人工字幕。', '中'.repeat(260)])
    expect(result.diagnostics).toEqual(expect.objectContaining({
      boundaryMethod: 'manual-cues',
      boundaryRequestCount: 0,
    }))
  })

  it('retries a source-copy canonical response with a validation correction', async () => {
    mockGmFetch
      .mockResolvedValueOnce(boundaries('E'))
      .mockResolvedValueOnce(chatOk('[S001] モデラーの皆様には照明も重要です。'))
      .mockResolvedValueOnce(chatOk('[S001] 对模型制作者来说，照明也很重要。'))
    const promise = translateCues(
      [{ s: 0, d: 2000, o: 'モデラーの皆様には照明も重要です。' }],
      'zh-Hans',
      CFG,
      'key',
      { translation: { mode: 'sentence', batchSize: 8 } },
    )
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.cues[0].t).toBe('对模型制作者来说，照明也很重要。')
    const retryBody = JSON.parse(mockGmFetch.mock.calls[2][0].body as string)
    expect(retryBody.messages[1].content).toContain('PREVIOUS RESPONSE ERROR')
  })

  it('translates one complete sentence once, then aligns its immutable target to short cues', async () => {
    const cues = makeCues(20)
    mockGmFetch
      .mockResolvedValueOnce(boundaries(`${'C'.repeat(19)}E`))
      .mockResolvedValueOnce(chatOk('[S001] 甲乙，丙丁'))
      .mockResolvedValueOnce(chatOk('{"S001":[3]}'))

    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      context: { title: 'Gundam Marker' },
      translation: { mode: 'sentence', batchSize: 8 },
    })

    expect(mockGmFetch).toHaveBeenCalledTimes(3)
    expect(result.cues).toHaveLength(2)
    expect(result.cues.map((cue) => cue.t)).toEqual(['甲乙，', '丙丁'])
    expect(result.cues.map((cue) => cue.t).join('')).toBe('甲乙，丙丁')
    expect(result.cues[0].o).toBe(makeCues(15).map((cue) => cue.o).join(' '))
    expect(result.cues[1].o).toBe('L16 L17 L18 L19 L20')

    const translationBody = JSON.parse(mockGmFetch.mock.calls[1][0].body as string)
    expect(translationBody.messages[1].content).toContain('[S001] L1 L2')
    expect(translationBody.messages[1].content).not.toContain('TARGET IDS: S002')
    expect(translationBody.thinking).toEqual({ type: 'disabled' })
    expect(translationBody.temperature).toBe(0)
  })

  it('keeps the vvLnNHtY09U 17.7–32.6s semantic anchors in their source-owned sentences', async () => {
    const anchorCues: Cue[] = [
      {
        s: 17_720,
        d: 4_719,
        o: 'だけのキットとどれくらい違ってくるのか比較していきたいと思います。',
      },
      {
        s: 22_439,
        d: 5_201,
        o: '少し前の動画でガンダムマーカーの塗り方について解説しました。多くの方が見ていただきありがとうございます。',
      },
      {
        s: 27_640,
        d: 14_880,
        o: 'そこで今回は実際にその動画で解説したやり方を使って、ガンダムマーカーの部分塗装でパチ組とどれぐらい変わるのか検証します。',
      },
    ]
    mockGmFetch
      .mockResolvedValueOnce(boundaries('EEE'))
      .mockResolvedValueOnce(chatOk('[S001] 我想比较一下它与仅素组的套件有多大区别。'))
      .mockResolvedValueOnce(chatOk('[S002] 在稍早的视频中介绍了高达马克笔的涂法，感谢众多观众观看。'))
      .mockResolvedValueOnce(chatOk('[S003] 因此这次会实际采用视频中讲解的方法，用高达马克笔局部上色，验证与素组有多大差别。'))

    const result = await translateCues(anchorCues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
      getCurrentTime: () => 17_720,
    })

    const markerCue = result.cues.find((cue) => cue.s === 22_439)
    const methodCue = result.cues.find((cue) => cue.s === 27_640)
    expect(markerCue?.o).toContain('ガンダムマーカー')
    expect(markerCue?.t).toContain('高达马克笔')
    expect(markerCue?.t).toContain('观众')
    expect(methodCue?.o).toContain('その動画で解説したやり方')
    expect(methodCue?.t).toContain('视频中讲解的方法')
    expect(methodCue?.t).toContain('局部上色')
    expect(result.cues[0].t).not.toContain('高达马克笔')
  })

  it('falls back to one full-source/full-target cue after three invalid alignments', async () => {
    const cues = makeCues(20)
    mockGmFetch
      .mockResolvedValueOnce(boundaries(`${'C'.repeat(19)}E`))
      .mockResolvedValueOnce(chatOk('[S001] 完整中文，译文内容'))
      .mockResolvedValueOnce(chatOk('{"S001":[]}'))
      .mockResolvedValueOnce(chatOk('{"S001":[999]}'))
      .mockResolvedValueOnce(chatOk('not json'))

    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
    })
    expect(result.cues).toEqual([
      { s: 0, d: 20000, o: cues.map((cue) => cue.o).join(' '), t: '完整中文，译文内容' },
    ])
    expect(result.diagnostics.alignmentRequestCount).toBe(3)
    expect(result.diagnostics.fallbackSentenceCount).toBe(1)
  })

  it('falls back without futile alignment requests when no safe cut can exist', async () => {
    const cues = makeCues(20)
    mockGmFetch
      .mockResolvedValueOnce(boundaries(`${'C'.repeat(19)}E`))
      .mockResolvedValueOnce(chatOk('[S001] 连续汉字没有标点'))

    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
    })
    expect(mockGmFetch).toHaveBeenCalledTimes(2)
    expect(result.cues).toEqual([
      { s: 0, d: 20000, o: cues.map((cue) => cue.o).join(' '), t: '连续汉字没有标点' },
    ])
    expect(result.diagnostics.alignmentRequestCount).toBe(0)
    expect(result.diagnostics.fallbackSentenceCount).toBe(1)
  })

  it('warms the playhead sentence first and exposes sentence-mode progress', async () => {
    const cues = makeCues(3)
    const progress: number[] = []
    mockGmFetch.mockImplementation(async (request) => {
      const body = request.body as string
      if (body.includes('[<n>] E')) return boundaries('EEE')
      return translations(targetIds(body))
    })

    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
      getCurrentTime: () => 2200,
      onProgress: (event) => {
        if (event.stage === 'translating') progress.push(event.completedSentences)
      },
    })

    expect(targetIds(mockGmFetch.mock.calls[1][0].body as string)).toEqual(['S003'])
    expect(progress[0]).toBe(0)
    expect(progress).toContain(1)
    expect(progress.at(-1)).toBe(3)
    expect(result.cues.map((cue) => cue.t)).toEqual(['T-S001', 'T-S002', 'T-S003'])
  })

  it('re-reads the playhead when dequeuing pending work after warm-up', async () => {
    const cues = makeCues(12)
    const getCurrentTime = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValue(11_200)
    mockGmFetch.mockImplementation(async (request) => {
      const body = request.body as string
      if (body.includes('[<n>] E')) return boundaries('E'.repeat(12))
      return translations(targetIds(body))
    })

    await translateCues(cues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
      getCurrentTime,
    })
    expect(targetIds(mockGmFetch.mock.calls[1][0].body as string)).toEqual(['S001'])
    expect(targetIds(mockGmFetch.mock.calls[2][0].body as string)).toEqual(['S012'])
  })

  it('updates batch mode only after each complete batch and preserves source order', async () => {
    const cues = makeCues(4)
    const progress: number[] = []
    mockGmFetch.mockImplementation(async (request) => {
      const body = request.body as string
      if (body.includes('[<n>] E')) return boundaries('EEEE')
      return translations(targetIds(body))
    })
    const result = await translateCues(cues, 'zh-Hans', CFG, 'key', {
      translation: { mode: 'batch', batchSize: 2 },
      onProgress: (event) => {
        if (event.stage === 'translating') progress.push(event.completedSentences)
      },
    })
    expect(progress).toEqual([0, 2, 4])
    expect(result.cues.map((cue) => cue.t)).toEqual(['T-S001', 'T-S002', 'T-S003', 'T-S004'])
  })

  it('counts parse-invalid HTTP-success usage before retrying', async () => {
    const usageStages: Array<{ stage: string; completion?: number }> = []
    const usage = {
      prompt_tokens: 10,
      prompt_cache_hit_tokens: 8,
      prompt_cache_miss_tokens: 2,
      completion_tokens: 3,
      total_tokens: 13,
    }
    mockGmFetch
      .mockResolvedValueOnce(boundaries('E'))
      .mockResolvedValueOnce(chatOk('malformed', usage))
      .mockResolvedValueOnce(chatOk('[S001] 正确', usage))

    const promise = translateCues(makeCues(1), 'zh-Hans', CFG, 'key', {
      translation: { mode: 'whole', batchSize: 8 },
      onUsage: (stage, value) => {
        usageStages.push({ stage, completion: value?.completionTokens })
      },
    })
    await vi.runAllTimersAsync()
    await promise
    expect(usageStages.filter((entry) => entry.stage === 'translation')).toEqual([
      { stage: 'translation', completion: 3 },
      { stage: 'translation', completion: 3 },
    ])
  })

  it('fails closed when boundary output remains malformed instead of translating fragments', async () => {
    mockGmFetch.mockResolvedValue(chatOk('[1] E'))
    const promise = translateCues(makeCues(3), 'zh-Hans', CFG, 'key', {
      translation: { mode: 'sentence', batchSize: 8 },
    })
    const assertion = expect(promise).rejects.toThrow(/missing fragments/i)
    await vi.runAllTimersAsync()
    await assertion
    expect(mockGmFetch).toHaveBeenCalledTimes(3)
  })

  it('preserves the failed sentence cause, source and timing at the pipeline boundary', async () => {
    mockGmFetch.mockResolvedValue(chatOk('[S001] モデラーの皆様には照明も重要です。'))
    const promise = translateCues(
      [{ s: 12_340, d: 2340, o: '照明について詳しく説明します。', sentenceEnd: true }],
      'zh-Hans',
      CFG,
      'key',
      { translation: { mode: 'sentence', batchSize: 8 } },
    ).catch((error: unknown) => error)

    await vi.runAllTimersAsync()
    const error = await promise
    expect(error).toMatchObject({
      name: 'TranslationJobsIncompleteError',
      failures: [{
        id: 'S001',
        sourceText: '照明について詳しく説明します。',
        startMs: 12_340,
        endMs: 14_680,
        causeName: 'CountMismatchError',
        causeMessage: 'Canonical target is Japanese-heavy and not in the target language',
      }],
    })
    expect((error as Error).message).toContain('S001 12340-14680ms CountMismatchError')
    expect((error as Error).message).toContain('照明について詳しく説明します。')
  })

  it('aborts without fallback or a completed artifact', async () => {
    const controller = new AbortController()
    mockGmFetch.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    await expect(translateCues(makeCues(3), 'zh-Hans', CFG, 'key', {
      signal: controller.signal,
      translation: { mode: 'sentence', batchSize: 8 },
    })).rejects.toThrow(/abort/i)
    expect(mockGmFetch).toHaveBeenCalledOnce()
  })
})
