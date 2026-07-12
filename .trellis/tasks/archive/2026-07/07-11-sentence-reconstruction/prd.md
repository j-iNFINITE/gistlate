# Sentence reconstruction: group cues into sentences for coherent translation and display

## Goal

Improve translation quality for monologue / auto-generated (unpunctuated ASR)
YouTube captions by translating at the **sentence** level instead of per-fragment.
Group consecutive caption fragments into complete sentences, translate each
sentence with full-video context, and display the **full original sentence + full
translation** for the sentence's on-screen duration.

## Background / decisions (from brainstorm)

- Builds on `archive/2026-07/07-11-style-and-oneshot-translation` (one-shot
  translation). Current behavior translates each cue (fragment) 1:1, so monologue
  subtitles show half-sentence translations.
- Target content is mostly **YouTube auto-generated captions**: no punctuation,
  word/phrase fragments → heuristic (punctuation/pause) grouping fails. **LLM
  -assisted segmentation is required** and is the chosen approach.
- Decided:
  1. The LLM does **segmentation + translation in one pass**, returning
     `[start-end] translation` lines; we **validate full coverage** and **fall back
     to today's 1:1 fragment translation** on malformed output.
  2. Display = **full original sentence + full translation** (both complete, stay
     for the sentence duration). Translation-only mode shows the full sentence
     translation.
  3. Keep the `{s,d,o,t}` cue schema (pool-compatible); store **sentence-level
     cues**; **no migration** — existing fragment-level pool entries still load and
     display (at old quality).

## Requirements

- **R1 — One-pass segment+translate.** Input: numbered fragments `[1]..[N]`.
  Output: one line per sentence `[<start>-<end>] <translation>` (or `[<n>]
  <translation>` for a single-fragment sentence), where ranges are inclusive
  fragment numbers, contiguous, and cover `1..N` exactly once. Prompt tells the
  model the fragments are consecutive auto-captions (often unpunctuated) of one
  video; group into complete sentences, add natural punctuation, translate
  coherently with consistent terminology.
- **R2 — Coverage validation.** Parsed ranges must: start at 1, be sorted and
  contiguous (`next.start === prev.end + 1`), not overlap, and end at `N`. Invalid
  → retry (≤ small N); still invalid → fall back (R3).
- **R3 — Fallback (never worse than today).** On unrecoverable segmentation
  failure, translate fragments **1:1** using the existing path; result is
  fragment-level cues. No crash, no missing lines.
- **R4 — Sentence-cue construction.** Each sentence → one `Cue`:
  `{ s: firstFrag.s, d: (lastFrag.s + lastFrag.d) - firstFrag.s,
     o: joined original fragments, t: sentence translation }`.
- **R5 — Adaptive split preserved.** On truncation (`finish_reason==='length'`),
  split the fragment range in half and segment+translate each half (a sentence
  straddling the split may be cut — acceptable); concatenate sentence-cues.
- **R6 — Invariants unchanged.** One-shot whole video, write-on-full-success,
  `AbortSignal`, L1→L2 orchestration, and the stored schema are all preserved.
- **R7 — Display.** Bilingual shows full sentence original + full translation;
  translation-only shows the full sentence translation. Because sentence-cues carry
  full `o`+`t`, the existing overlay/`findCueAt` needs **no change**.
- **R8 — Strip non-speech annotations.** Auto-captions embed accessibility
  annotations (for deaf/HoH) like `[Music]`, `[Applause]`, `[Laughter]`, `[音乐]`,
  `【掌声】`, and `♪`, which corrupt sentence grouping + translation. Before
  segmentation: remove square/full-width bracketed annotations (`\[[^\]]*\]`,
  `【[^】]*】`) entirely, strip stray `♪` symbols (keeping any lyric text between
  them), collapse whitespace, and **drop fragments that become empty** (pure
  annotations). Applied at parse time, so removed annotations neither display nor
  pollute sentences.

## Constraints

- No new deps; vanilla TS; single-IIFE build (no dynamic `import()`); Trusted
  Types safe (createElement/textContent only — but this task adds no new DOM).
- Pool schema unchanged; mixed old (fragment) / new (sentence) entries both valid.
- Keep the M2 typed errors + adaptive-split machinery; reuse where possible.

## Acceptance Criteria

- [ ] On a YouTube auto-caption (unpunctuated) monologue video, subtitles display
      **complete translated sentences** (not fragments), each staying on screen for
      its speaking duration, with the full original sentence above (bilingual).
- [ ] Segmentation output is validated to cover all fragments; a malformed /
      uncovered response **falls back to 1:1** fragment translation — no crash, no
      missing lines, every cue still translated.
- [ ] The stored artifact is sentence-level `{s,d,o,t}` cues; it loads and
      displays; the pool schema is unchanged; a pre-existing **fragment-level** pool
      entry still loads and displays.
- [ ] Non-speech annotations (`[Music]`, `[Applause]`, `[音乐]`, `♪`, …) are removed
      before translation: they do not appear in the overlay and do not corrupt
      neighboring sentences; a fragment that is only an annotation is dropped.
- [ ] A long video that truncates still completes via adaptive split.
- [ ] Fail-closed preserved (unrecoverable failure writes nothing to L2); SPA
      navigation mid-flight aborts cleanly with no stale write.
- [ ] Unit tests cover: non-speech stripping (bracketed, 【】, ♪, inline, empty
      drop), segment parse/validate (valid, gap, overlap, missing, single-fragment,
      out-of-order), pipeline segment-happy (sentence-cues), truncation→split, and
      invalid-segmentation→fallback (fragment cues).

## Out of scope

- A separate heuristic (punctuation/pause) grouping path (unified LLM path chosen).
- Re-translate / force-refresh UI for old fragment-level pool entries (future).
- Per-word karaoke highlighting of the original line.
- `v` schema versioning / pool migration.
