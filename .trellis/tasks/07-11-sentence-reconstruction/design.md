# Technical Design — sentence reconstruction

> Builds on the one-shot translation pipeline. Reuses M2's typed errors +
> adaptive split. No schema change, no new deps.

## 1. Flow overview

```
fragments (parseTimedtext)                       ── unchanged
      │
      ▼
segmentAndTranslate(fragments)                   ── NEW: one LLM pass
   • prompt: group consecutive fragments into sentences + translate
   • output lines: "[start-end] translation"
   • parse -> Sentence[] {startIdx, endIdx, t}
   • validate full 1..N coverage
   • on truncation -> split fragment range, recurse (like M2)
      │  (valid)                      │ (invalid after retry / non-splittable)
      ▼                               ▼
 build sentence-cues            FALLBACK: translateFragments1to1()  (today's path)
 {s,d,o=joined,t}                -> fragment-level cues
      │                               │
      └──────────────┬────────────────┘
                     ▼
          Cue[]  (stored in L1/L2, displayed)
```

`translateAllCues(cues, targetLang, cfg, apiKey, signal)` keeps its signature and
its callers (`resolve.ts`). Internally it now tries segmentation first, falling
back to the existing 1:1 range translation.

## 1b. Non-speech cleaning (pre-segmentation)

`subtitles/clean.ts` (new): `cleanCues(cues: Cue[]): Cue[]`.

- For each cue's `o`: remove `\[[^\]]*\]` and `【[^】]*】` (whole annotation), remove
  `♪` symbols (keep any lyric text that sat between them), collapse whitespace,
  trim.
- Drop cues whose cleaned `o` is empty (pure annotations like `[Music]`).
- `stripNonSpeech(text: string): string` is the reusable core; `cleanCues` maps +
  filters.

Wired in **`main.ts`** right after `parseTimedtext`, before `store.setSubtitle` and
`triggerTranslation`, so annotations are gone from BOTH display and the segmentation
input. (Keeps overlay/pipeline oblivious to annotations.)

Note: only square/full-width brackets + `♪` are stripped. Parentheses `(...)` are
NOT stripped (they carry real speech in many transcripts). Speaker labels (`>>`,
`- Name:`) are out of scope for this round.

## 2. Data model (no schema change)

- Public `Cue = { s, d, o, t }` unchanged. Stored artifact stays
  `{key,videoId,src,tgt,model,cues,createdAt}`.
- Internal only (not stored):
  ```ts
  interface Sentence { startIdx: number; endIdx: number; t: string } // 0-based, inclusive
  ```
- Sentence → Cue:
  ```ts
  const first = frags[s.startIdx], last = frags[s.endIdx]
  const cue: Cue = {
    s: first.s,
    d: (last.s + last.d) - first.s,
    o: frags.slice(s.startIdx, s.endIdx + 1).map(f => f.o).join(' ').replace(/\s+/g,' ').trim(),
    t: s.t,
  }
  ```
- **Result**: `cues` becomes sentence-level (fewer entries, full o+t each). Existing
  fragment-level pool entries remain valid `{s,d,o,t}` arrays and display as before.

## 3. Segmentation prompt (`translate/prompt.ts`)

New `fillSegmentPrompt(fragments, targetLang)` → `{ system, user }`.

System (essentials):
```
You receive NUMBERED subtitle fragments from ONE video. They are consecutive and
often auto-generated (no punctuation). Group consecutive fragments into COMPLETE
sentences and translate each sentence into {{Target Language}}.

Output format — one line per sentence, nothing else:
[<start>-<end>] <translation>
- <start>-<end> = inclusive fragment numbers the sentence covers (use [<n>] if one).
- Ranges MUST be contiguous, non-overlapping, and cover every fragment from 1 to
  {{N}} exactly once, in order.
- Add natural punctuation. Keep terminology/names/tense consistent across the whole
  video. Translate faithfully; do not add commentary.
```
User: the numbered fragments (reuse the `[i] text` builder).

## 4. Parse + validate (`translate/segment.ts`, new)

```ts
export function parseSentences(output: string, n: number): Sentence[]
```
- Match each line against `^\s*\[(\d+)(?:\s*-\s*(\d+))?\]\s*(.+)$`.
  `end = m[2] ?? m[1]`. Push `{ startIdx: start-1, endIdx: end-1, t: text.trim() }`.
- Sort by startIdx. **Validate coverage** (throw `SegmentationError` on any):
  - first.startIdx === 0
  - for each consecutive pair: `next.startIdx === prev.endIdx + 1`
  - last.endIdx === n-1
  - every `startIdx <= endIdx`, all `t` non-empty
- `SegmentationError extends Error` (new typed error). Treated as splittable-ish
  only for retry accounting; on final failure the pipeline falls back (not split).

## 5. Pipeline (`translate/pipeline.ts` rewrite)

```ts
export async function translateAllCues(cues, targetLang, cfg, apiKey, signal?) {
  if (cues.length === 0) return []
  try {
    const sentences = await segmentRange(cues, targetLang, cfg, apiKey, signal)   // NEW
    return sentencesToCues(cues, sentences)
  } catch (e) {
    if (signal?.aborted) throw e            // don't fall back on abort
    console.warn('[Gistlate] Sentence segmentation failed; falling back to 1:1', e)
    const texts = cues.map(c => c.o)
    const t = await translateRange(texts, targetLang, cfg, apiKey, signal)        // EXISTING M2 path
    return cues.map((c, i) => ({ ...c, t: t[i] }))
  }
}
```

`segmentRange` mirrors M2's `translateRange` but for segmentation:
- call `segmentBatch(fragTexts)` (new in openai.ts: POST with the segment prompt,
  read content + finishReason; throw `TruncationError` on length).
- `parseSentences(content, n)` → on `SegmentationError`, retry ≤2; then throw.
- On `TruncationError` (splittable) and `len > MIN_SPLIT` and `depth < MAX_DEPTH`:
  split fragments in half, `segmentRange` each half, **offset** the right half's
  indices by `mid`, concat. (A sentence crossing the split is cut into two — rare,
  acceptable.)
- Non-splittable / floor reached → throw (caller falls back to 1:1).

`sentencesToCues(frags, sentences)` builds the sentence-cues (§2) and asserts every
`t` non-empty (write-on-full-success invariant).

## 6. openai.ts additions

- Extract the shared POST+parse into a helper if convenient, or add
  `segmentBatch(fragTexts, targetLang, cfg, apiKey, signal): Promise<{content, finishReason}>`
  using `fillSegmentPrompt`. Reuse `TruncationError`. No numbered-count parsing here
  (that's segmentation's job). Keep `translateBatch` (used by the 1:1 fallback)
  intact.

## 7. resolve.ts / main.ts

- No changes. `translateAllCues` signature and the `onTranslating` status hook are
  unchanged. The status pill still shows during the (now sentence-level) translation.

## 8. Edge cases

- 1 fragment → one sentence `[1]`.
- Fallback path → fragment-level cues (today's display). Logged.
- Truncated segmentation on a very long video → adaptive split; boundary sentence
  may split into two — acceptable.
- Model returns extra prose / wrong ranges repeatedly → `SegmentationError` →
  fallback (never a crash, never missing cues).
- `src === tgt` short-circuit stays in `main.ts` (no translation at all).
- Abort → propagates without fallback or write.
- Mixed pool: an old fragment-level L2 entry loads and displays as before.

## 9. Testing (`translate/segment.test.ts` new + extend `pipeline.test.ts`)

- **parseSentences:** valid multi + single-fragment; rejects gap, overlap, missing
  first (not starting at 1), missing last (< N), out-of-order, empty translation.
- **pipeline (mock gmFetch):**
  - segment happy path → sentence-cues (assert count < fragment count, o/t joined,
    time spans correct, single request).
  - truncation once → split → sentence-cues cover all.
  - invalid segmentation persists → **falls back** to 1:1 → fragment-cues (assert N
    cues, each translated).
  - abort → rejects, no fallback.
- Keep fake timers (fast suite).

## 10. Rollout
Single logical change; ship in one feat commit (+ tests). No schema/pool migration.
Old cached videos stay fragment-level until re-translated (out of scope to force).
