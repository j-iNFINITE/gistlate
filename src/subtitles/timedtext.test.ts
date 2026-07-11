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

  it('produces consecutive cues with non-zero durations', () => {
    const cues = parseTimedtext(wrappedResponse)
    expect(cues).toHaveLength(2)
    expect(cues[0].s).toBeLessThan(cues[1].s)
    expect(cues[0].d).toBe(2000)
    expect(cues[1].d).toBe(2000)
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
