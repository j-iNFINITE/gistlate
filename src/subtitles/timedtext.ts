/**
 * YouTube timedtext API types and parser.
 * Based on the public YouTube `/api/timedtext` response JSON format.
 */

// ── Raw API types ────────────────────────────────────

export interface TimedtextSegment {
  utf8: string
  /** Word-level offset within the parent event (ASR). */
  tOffsetMs?: number
  /** ASR confidence. */
  acAsrConf?: number
}

export interface TimedtextEvent {
  tStartMs: number
  dDurationMs?: number
  /** Caption line segments (1 segment for manual captions, ~1 per word for ASR). */
  segs?: TimedtextSegment[]
  /** When 1, this event is a continuation of the previous window. */
  wWinId?: 1
  /** When 1, appended text belongs to the same line as the previous event. */
  aAppend?: 1
}

export interface GetTimedtextResp {
  events: TimedtextEvent[]
}

// ── Internal cue (compact, minified key names) ──────

export interface Cue {
  /** startMs */
  s: number
  /** durationMs */
  d: number
  /** Original text */
  o: string
  /** Translated text (filled after translation / cache) */
  t?: string
}

// ── Parse ─────────────────────────────────────────────

/**
 * Convert a raw timedtext response to Cue[].
 *
 * Manual captions: each event is one line → one Cue.
 * Auto-generated (ASR): each event may have word-level segs; group consecutive
 * segs into sentence-ish cues. ASR events often lack dDurationMs; window id
 * and append markers indicate continuation.
 */
export function parseTimedtext(resp: GetTimedtextResp): Cue[] {
  const events = resp.events
  if (!events || events.length === 0) return []

  // First pass: join aAppend continuations and wWinId windows
  const merged: TimedtextEvent[] = []
  for (const ev of events) {
    // Skip pure window continuation events with no text content
    if (!ev.segs || ev.segs.length === 0) continue

    if (ev.aAppend === 1 && merged.length > 0) {
      // This event's text belongs to the previous line
      const last = merged[merged.length - 1]
      last.segs = (last.segs ?? []).concat(ev.segs)
      last.dDurationMs = ev.tStartMs + (ev.dDurationMs ?? 0) - last.tStartMs
    } else {
      merged.push({ ...ev, segs: [...(ev.segs ?? [])] })
    }
  }

  // Second pass: build cues
  const cues: Cue[] = []
  for (const ev of merged) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8)
      .join('')
      .trim()
    if (!text) continue

    const duration = ev.dDurationMs ?? estimateDuration(merged, ev)
    cues.push({ s: ev.tStartMs, d: duration, o: text })
  }

  return cues
}

/**
 * Estimate duration for events missing dDurationMs (common in ASR tracks).
 * If next event exists, use gap; otherwise a conservative default.
 */
function estimateDuration(events: TimedtextEvent[], ev: TimedtextEvent): number {
  const idx = events.indexOf(ev)
  if (idx < events.length - 1) {
    const next = events[idx + 1]
    // Cap at reasonable max for a subtitle cue
    return Math.min(next.tStartMs - ev.tStartMs, 8000)
  }
  return 4000
}
