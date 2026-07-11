import type { Cue } from './timedtext'

/**
 * Remove non-speech accessibility annotations from a caption line.
 *
 * Auto-generated captions embed annotations for deaf/HoH viewers that corrupt
 * sentence grouping and translation:
 * - Square-bracket annotations: `[Music]`, `[Applause]`, `[Laughter]`, …
 * - Full-width bracket annotations: `【音乐】`, `【掌声】`, …
 * - Musical-note markers `♪`: the symbols themselves are removed, but any lyric
 *   text that sat between them is kept.
 *
 * Whitespace is collapsed and the result trimmed. Parentheses `(...)` are NOT
 * stripped — they frequently carry real speech in transcripts.
 */
export function stripNonSpeech(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/♪/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip non-speech annotations from every cue's original text and drop cues that
 * become empty (pure annotations like `[Music]`). Timing fields are preserved.
 *
 * Applied right after parsing, so removed annotations neither display nor pollute
 * the sentence-segmentation input.
 */
export function cleanCues(cues: Cue[]): Cue[] {
  const out: Cue[] = []
  for (const c of cues) {
    const o = stripNonSpeech(c.o)
    if (o === '') continue
    out.push({ ...c, o })
  }
  return out
}
