# Implementation Plan — sentence reconstruction

> One coherent change. Validation baseline after each step: `pnpm compile`,
> `pnpm test`, `pnpm build` (single IIFE, zero systemjs). Follow `design.md`.
> No new deps; no schema change.

## Step 0 — Strip non-speech annotations
- [ ] `subtitles/clean.ts` (new): `stripNonSpeech(text)` (remove `[...]`/`【...】`,
      strip `♪` keeping inner text, collapse whitespace) + `cleanCues(cues)` (map +
      drop empties) per design §1b.
- [ ] `main.ts`: apply `cleanCues` right after `parseTimedtext`, before
      `store.setSubtitle` + `triggerTranslation`.

## Step 1 — Segmentation prompt
- [ ] `translate/prompt.ts`: add `fillSegmentPrompt(fragments, targetLang)` →
      `{system,user}` per design §3 (contiguous `[start-end] translation`, cover
      1..N, add punctuation, consistent terminology). Reuse the numbered `[i] text`
      user builder.

## Step 2 — Parse + validate
- [ ] `translate/segment.ts` (new): `Sentence` type; `SegmentationError`;
      `parseSentences(output, n): Sentence[]` with full-coverage validation
      (start at 1, contiguous, no overlap/gap, end at N, non-empty t) per design §4.
- [ ] `sentencesToCues(frags, sentences): Cue[]` (join originals, compute time span,
      assert non-empty t) per design §2.

## Step 3 — LLM call
- [ ] `translate/openai.ts`: add `segmentBatch(fragTexts, targetLang, cfg, apiKey,
      signal)` returning `{content, finishReason}` via `fillSegmentPrompt`; throw
      `TruncationError` on `finish_reason==='length'`. Reuse existing transport +
      error types. Do NOT change `translateBatch` (fallback uses it).

## Step 4 — Pipeline (segment-first + fallback)
- [ ] `translate/pipeline.ts`: rewrite `translateAllCues` to try `segmentRange`
      (recursive: parse+validate, retry on `SegmentationError`, adaptive half-split
      on `TruncationError` with right-half index offset, `MIN_SPLIT`/`MAX_DEPTH`
      floors) → `sentencesToCues`; on unrecoverable failure (not abort) **fall back**
      to the existing 1:1 `translateRange` → fragment cues (design §5). Keep
      `translateRange` for the fallback. Preserve `AbortSignal` + write-on-success.
- [ ] `core/resolve.ts` / `main.ts`: no change needed — verify call site + status
      hook still compile and behave.

## Step 5 — Tests
- [ ] `subtitles/clean.test.ts` (new): `stripNonSpeech`/`cleanCues` — `[Music]`
      dropped, `【音乐】` dropped, inline `and then [laughter] he...` cleaned, `♪ la la ♪`
      keeps `la la`, whitespace collapsed, pure-annotation cue removed, plain speech
      untouched.
- [ ] `translate/segment.test.ts` (new): `parseSentences` valid multi/single;
      rejects gap, overlap, not-starting-at-1, short-of-N, out-of-order, empty t.
- [ ] `translate/pipeline.test.ts` (extend/rewrite, mock `gmFetch`): segment happy
      → sentence-cues (fewer than fragments, joined o/t, correct spans, one request);
      truncation→split→full coverage; persistent invalid segmentation→**fallback to
      1:1** (N fragment cues, each translated); abort→reject no fallback. Keep fake
      timers.
- **DoD:** all AC in `prd.md`; `pnpm compile && pnpm test && pnpm build` green;
  built `.user.js` single IIFE.

## Final gate (2.2)
- [ ] Manual E2E on a real YouTube **auto-caption monologue** video: complete
      translated sentences display (not fragments); force a bad segmentation (or use
      a tiny model) to confirm graceful fallback; confirm an already-cached
      fragment-level video still loads.
- [ ] Dispatch `trellis-check`.
- [ ] Confirm: fail-closed, no schema change, single IIFE, no dynamic import.

## Risks / mitigations
- LLM returns imperfect ranges → coverage validation + retry + **fallback to 1:1**
  (never crashes, never drops cues).
- Boundary sentence split by adaptive halving → rare; acceptable seam.
- Old cached videos stay fragment-level until re-translated → documented, out of
  scope to force-refresh this round.
