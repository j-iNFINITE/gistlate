import { describe, it, expect } from 'vitest'
import { parseTimedtext, type GetTimedtextResp } from './timedtext'
import { findCueAt, getCuesToTranslate } from './cues'

// ── Manual captions fixture ───────────────────────────

const manualResponse: GetTimedtextResp = {
  events: [
    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Hello' }] },
    { tStartMs: 1500, dDurationMs: 2000, segs: [{ utf8: 'world.' }] },
    { tStartMs: 3500, dDurationMs: 2500, segs: [{ utf8: 'This is a test.' }] },
  ],
}

// ── ASR fixture (word-level segs, no dDurationMs) ─────

const asrResponse: GetTimedtextResp = {
  events: [
    { tStartMs: 0, segs: [{ utf8: 'Welcome ', tOffsetMs: 0 }, { utf8: 'to ', tOffsetMs: 400 }, { utf8: 'the ', tOffsetMs: 800 }, { utf8: 'show.' }] },
    { tStartMs: 2000, segs: [{ utf8: 'Today ', tOffsetMs: 0 }, { utf8: 'we ', tOffsetMs: 500 }, { utf8: 'talk.' }] },
  ],
}

// ── aAppend fixture (continuations) ───────────────────

const appendResponse: GetTimedtextResp = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Line one' }] },
    { tStartMs: 2000, dDurationMs: 1500, aAppend: 1, segs: [{ utf8: ' continues' }] },
  ],
}

// ── Empty fixture ─────────────────────────────────────

const emptyResponse: GetTimedtextResp = { events: [] }

// ── Wrapped segment fixture (no event-level duration, one segment per event) ──

const wrappedResponse: GetTimedtextResp = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'First line' }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'Second line.' }] },
  ],
}

// Derived from Ru7H092hFAI ja-orig JSON3: real sentence stops frequently occur
// inside one Google event, followed immediately by the next sentence.
const internalSentenceResponse: GetTimedtextResp = {
  events: [
    {
      tStartMs: 160,
      dDurationMs: 4960,
      wWinId: 1,
      segs: [
        { utf8: 'はい', tOffsetMs: 0 },
        { utf8: '、', tOffsetMs: 199 },
        { utf8: 'こんにちは', tOffsetMs: 280 },
        { utf8: '。', tOffsetMs: 680 },
        { utf8: 'ポジティブ', tOffsetMs: 840 },
        { utf8: 'モデラー', tOffsetMs: 1320 },
      ],
    },
    { tStartMs: 1829, dDurationMs: 3291, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
    {
      tStartMs: 1839,
      dDurationMs: 7201,
      wWinId: 1,
      segs: [
        { utf8: '野良', tOffsetMs: 0 },
        { utf8: 'です', tOffsetMs: 241 },
        { utf8: '。', tOffsetMs: 401 },
        { utf8: '今回', tOffsetMs: 800 },
        { utf8: 'の', tOffsetMs: 1121 },
        { utf8: '動画', tOffsetMs: 1241 },
        { utf8: 'は', tOffsetMs: 1481 },
        { utf8: '高い', tOffsetMs: 2241 },
        { utf8: 'けど', tOffsetMs: 2520 },
        { utf8: '使う', tOffsetMs: 2881 },
        { utf8: 'と', tOffsetMs: 3161 },
      ],
    },
    { tStartMs: 5110, dDurationMs: 3930, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
    {
      tStartMs: 5120,
      dDurationMs: 7000,
      wWinId: 1,
      segs: [
        { utf8: '納得', tOffsetMs: 0 },
        { utf8: 'する', tOffsetMs: 320 },
        { utf8: '模型', tOffsetMs: 639 },
        { utf8: 'ツール', tOffsetMs: 1000 },
        { utf8: '。', tOffsetMs: 1360 },
        { utf8: '私', tOffsetMs: 2239 },
        { utf8: 'は', tOffsetMs: 2480 },
        { utf8: '本格的', tOffsetMs: 2759 },
        { utf8: 'に', tOffsetMs: 3320 },
        { utf8: '模型', tOffsetMs: 3479 },
        { utf8: 'を', tOffsetMs: 3800 },
      ],
    },
  ],
}

describe('parseTimedtext', () => {
  it('parses manual captions into cues', () => {
    const cues = parseTimedtext(manualResponse)
    expect(cues).toHaveLength(3)
    expect(cues[0]).toEqual({ s: 0, d: 1500, o: 'Hello' })
    expect(cues[1]).toEqual({ s: 1500, d: 2000, o: 'world.' })
    expect(cues[2]).toEqual({ s: 3500, d: 2500, o: 'This is a test.' })
  })

  it('parses ASR word-level segments into cues', () => {
    const cues = parseTimedtext(asrResponse)
    expect(cues).toHaveLength(2)
    expect(cues[0].o).toBe('Welcome to the show.')
    expect(cues[0].s).toBe(0)
    expect(cues[0].d).toBeGreaterThan(0)
    expect(cues[1].o).toBe('Today we talk.')
    expect(cues[1].s).toBe(2000)
  })

  it('joins aAppend continuations into previous cue', () => {
    const cues = parseTimedtext(appendResponse)
    expect(cues).toHaveLength(1)
    expect(cues[0].o).toBe('Line one continues')
    expect(cues[0].s).toBe(0)
  })

  it('returns empty array for no events', () => {
    expect(parseTimedtext(emptyResponse)).toEqual([])
  })

  it('handles events with empty/null segs gracefully', () => {
    const resp: GetTimedtextResp = {
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'OK' }] },
        { tStartMs: 1000, dDurationMs: 1000 },
      ],
    }
    const cues = parseTimedtext(resp)
    expect(cues).toHaveLength(1)
    expect(cues[0].o).toBe('OK')
  })

  it('handles events with no segs property at all', () => {
    const resp: GetTimedtextResp = {
      events: [
        {} as any,
        { tStartMs: 500, dDurationMs: 1000, segs: [{ utf8: 'Works' }] },
      ],
    }
    const cues = parseTimedtext(resp)
    expect(cues).toHaveLength(1)
    expect(cues[0].o).toBe('Works')
  })

  it('keeps legacy event parsing when word offsets are too sparse', () => {
    const cues = parseTimedtext({
      events: [{
        tStartMs: 0,
        dDurationMs: 1000,
        segs: [
          { utf8: 'One ', tOffsetMs: 0 },
          { utf8: 'manual ' },
          { utf8: 'line.' },
        ],
      }],
    })
    expect(cues).toEqual([{ s: 0, d: 1000, o: 'One manual line.' }])
  })

  it('produces consecutive cues with non-zero durations', () => {
    const cues = parseTimedtext(wrappedResponse)
    expect(cues).toHaveLength(2)
    expect(cues[0].s).toBeLessThan(cues[1].s)
    expect(cues[0].d).toBe(2000)
    expect(cues[1].d).toBe(2000)
  })

  it('uses word offsets to expose sentence boundaries inside Google ASR events', () => {
    const cues = parseTimedtext(internalSentenceResponse)
    expect(cues.map((cue) => cue.o)).toEqual([
      'はい、こんにちは。',
      'ポジティブモデラー',
      '野良です。',
      '今回の動画は高いけど使うと',
      '納得する模型ツール。',
      '私は本格的に模型を',
    ])
    expect(cues.map((cue) => cue.sentenceEnd)).toEqual([true, false, true, false, true, true])
    expect(cues[0].s).toBe(160)
    expect(cues[1].s).toBe(1000)
    expect(cues[2].s).toBe(1839)
    expect(cues[3].s).toBe(2639)
  })

  it('attaches a sentence mark at the next event start to the preceding fragment', () => {
    const cues = parseTimedtext({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 2500,
          segs: [
            { utf8: '電動', tOffsetMs: 0 },
            { utf8: 'ツール', tOffsetMs: 400 },
            { utf8: 'です', tOffsetMs: 800 },
          ],
        },
        {
          tStartMs: 1500,
          dDurationMs: 1500,
          segs: [
            { utf8: '。', tOffsetMs: 0 },
            { utf8: '模型', tOffsetMs: 200 },
            { utf8: '制作', tOffsetMs: 500 },
            { utf8: '。', tOffsetMs: 800 },
          ],
        },
      ],
    })
    expect(cues.map((cue) => cue.o)).toEqual(['電動ツールです。', '模型制作。'])
    expect(cues.map((cue) => cue.sentenceEnd)).toEqual([true, true])
    expect(cues[0].s + cues[0].d).toBe(cues[1].s)
  })

  it('keeps decimal/version periods and punctuation runs intact', () => {
    const cues = parseTimedtext({
      events: [{
        tStartMs: 0,
        dDurationMs: 2500,
        segs: [
          { utf8: 'Version ', tOffsetMs: 0 },
          { utf8: '4.0 ', tOffsetMs: 300 },
          { utf8: 'works!', tOffsetMs: 700 },
          { utf8: 'Wait...', tOffsetMs: 1200 },
          { utf8: 'Done.', tOffsetMs: 1800 },
        ],
      }],
    })
    expect(cues.map((cue) => cue.o)).toEqual(['Version 4.0 works!', 'Wait...', 'Done.'])
    expect(cues.every((cue) => cue.sentenceEnd)).toBe(true)
  })
})

describe('findCueAt', () => {
  const cues = parseTimedtext(manualResponse)

  it('finds the first cue at time 0', () => {
    const c = findCueAt(cues, 0)
    expect(c?.o).toBe('Hello')
  })

  it('finds a cue mid-range', () => {
    const c = findCueAt(cues, 2000)
    expect(c?.o).toBe('world.')
  })

  it('returns undefined before any cue', () => {
    expect(findCueAt(cues, -100)).toBeUndefined()
  })

  it('returns undefined after all cues', () => {
    expect(findCueAt(cues, 99999)).toBeUndefined()
  })

  it('finds cue at exact boundary', () => {
    const c = findCueAt(cues, 1500)
    expect(c?.o).toBe('world.')
  })
})

describe('getCuesToTranslate', () => {
  const cues = parseTimedtext(manualResponse).map((c, i) => ({
    ...c,
    ...(i === 1 ? { t: 'already translated' } : {}),
  }))

  it('returns untranslated cues around current time', () => {
    const toTranslate = getCuesToTranslate(cues, 0, 2)
    expect(toTranslate.every((c) => !c.t)).toBe(true)
    expect(toTranslate.length).toBeGreaterThan(0)
  })

  it('returns empty when window has all translated', () => {
    const allTranslated = cues.map((c) => ({ ...c, t: 'x' }))
    expect(getCuesToTranslate(allTranslated, 1500, 2)).toHaveLength(0)
  })

  it('returns empty when time before any cue', () => {
    expect(getCuesToTranslate(cues, -100, 2)).toHaveLength(0)
  })
})
