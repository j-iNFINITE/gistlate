# Technical Design — sentence reconstruction (Approach B: two-pass)

> The one-pass "segment+translate+report ranges" approach was UNRELIABLE: the
> model's reported fragment ranges drifted out of sync with its translations
> (structurally valid coverage, but semantically misaligned — the overlay showed a
> sentence's translation over the wrong fragments' time). We replace it with a
> **two-pass** design where alignment is guaranteed by construction.

## 1. Flow overview (two-pass)

```
fragments (parseTimedtext -> cleanCues)                     ── §1b
      │
      ▼
PASS 1 — boundary detection (reliable, 1:1)
   • prompt: for each numbered fragment, say if it ENDS a sentence
   • output: "[n] E" (ends) / "[n] C" (continues), one line per fragment
   • parse -> boolean isEnd[1..N]; validate every fragment present (count==N)
   • group deterministically -> sentence ranges [{startIdx,endIdx}]
      │
      ▼
PASS 2 — translate whole sentences (reliable, reuse M2)
   • sentenceTexts = join fragments per range
   • translateRange(sentenceTexts)  (numbered 1:1 -> aligned, adaptive split kept)
      │
      ▼
build sentence-cues  (o=joined original, t=sentence translation,
                      time = clamp end to NEXT sentence's start)
      │  (any unrecoverable failure, not abort)
      ▼
FALLBACK: translateRange(fragment texts) -> fragment-level cues  (never worse than aligned fragments)
```

**Why aligned by construction:** we GROUP first (deterministically from per-fragment
boundary flags), then translate each group SEPARATELY. Each sentence's `o`, `t`, and
time all come from the SAME fragment range. Even if the model's boundary flags are
imperfect, the result is at worst a slightly-off boundary — never a mis-timed
translation.

`translateAllCues(cues, targetLang, cfg, apiKey, signal)` keeps its signature.

## 1b. Non-speech cleaning (unchanged, pre-pass-1)

`subtitles/clean.ts` `cleanCues` runs in `main.ts` right after `parseTimedtext`
(strip `[...]`/`【...】`, remove `♪` keeping inner text, drop empty). Already shipped.

## 2. Data model + sentence-cue timing (no schema change)

- Public `Cue = { s, d, o, t }` unchanged; stored artifact unchanged.
- Internal: `interface SentenceRange { startIdx: number; endIdx: number }` (0-based inclusive).
- **Sentence-cue construction with time clamping** (`sentencesToCues`):
  For sentence `i` covering frags `[a..b]`, with the ordered range list:
  ```
  s_i = frags[a].s
  end_i = (i < last) ? frags[ranges[i+1].startIdx].s          // clamp to next sentence's start
                     : (frags[b].s + frags[b].d)              // last sentence: raw end
  d_i = max(1, end_i - s_i)
  o_i = frags.slice(a, b+1).map(f=>f.o).join(' ').replace(/\s+/g,' ').trim()
  t_i = translations[i]
  ```
  Clamping to the next sentence's start fixes ASR's overlapping/estimated fragment
  durations (a later fragment often starts before the previous fragment's estimated
  end), giving gap-free, non-overlapping sequential display.
- Result: `cues` becomes sentence-level; schema stays `{s,d,o,t}`; old fragment-level
  pool entries still load.

## 3. Pass 1 prompt (`translate/prompt.ts`)

Replace `fillSegmentPrompt` with `fillBoundaryPrompt(fragments, targetLang?)`:
```
You receive NUMBERED subtitle fragments from ONE video (consecutive, often
auto-generated with NO punctuation). For EACH fragment decide whether it ends a
sentence.

Output EXACTLY one line per fragment, nothing else:
[<n>] E   ← if fragment <n> ends a sentence (or a clause you'd end with 。/./?/!)
[<n>] C   ← if the sentence continues into the next fragment

Cover every fragment from 1 to {{N}} in order. Do NOT translate here.
```
(No target language strictly needed; boundary decision is source-side. Keep the
numbered `[i] text` builder for the user message.)

## 4. Parse + group (`translate/segment.ts`)

- `parseBoundaries(output: string, n: number): boolean[]` — match `^\s*\[(\d+)\]\s*([EC])\b`; fill `isEnd[idx]`; require every 1..N present (else `SegmentationError`). Force `isEnd[n-1] = true` (last fragment always ends the final sentence).
- `groupByBoundaries(isEnd: boolean[]): SentenceRange[]` — accumulate indices; close a range at each `isEnd`. Guarantees full contiguous coverage 0..n-1.
- `SegmentationError extends Error` (kept).
- `sentencesToCues(frags, ranges, translations)` — build cues per §2 (time clamp); assert `translations.length === ranges.length` and every `t` non-empty.

Keep the numbered-output parser (`parseNumbered`) for pass 2 via `translateRange`.

## 5. Pass 2 — sentence translation

Reuse the existing, proven `translateRange(texts, targetLang, cfg, apiKey, signal)`
(numbered 1:1, count-validated, adaptive split on truncation) with the SENTENCE
texts. Aligned 1:1 sentence↔translation. No new logic.

## 6. Pipeline (`translate/pipeline.ts`)

```ts
export async function translateAllCues(cues, targetLang, cfg, apiKey, signal?) {
  if (cues.length === 0) return []
  try {
    const isEnd = await detectBoundaries(cues, cfg, apiKey, signal)   // pass 1 (+retry)
    const ranges = groupByBoundaries(isEnd)
    const sentenceTexts = ranges.map(r =>
      cues.slice(r.startIdx, r.endIdx + 1).map(c => c.o).join(' ').replace(/\s+/g,' ').trim())
    const translations = await translateRange(sentenceTexts, targetLang, cfg, apiKey, signal) // pass 2
    return sentencesToCues(cues, ranges, translations)
  } catch (e) {
    if (signal?.aborted) throw e
    console.warn('[Gistlate] Sentence reconstruction failed; falling back to 1:1', e)
    const t = await translateRange(cues.map(c => c.o), targetLang, cfg, apiKey, signal)
    const out = cues.map((c, i) => ({ ...c, t: t[i] }))
    if (out.some(c => !c.t || !c.t.trim())) throw new Error('empty translations in fallback')
    return out
  }
}
```
`detectBoundaries(cues, ...)`: call `boundaryBatch` (openai), `parseBoundaries`,
retry ≤2 on `SegmentationError`/transport. **No adaptive split for pass 1** — the
E/C output is tiny; a truncation there just fails → fallback to 1:1. (Pass 2 keeps
the adaptive split where it matters.)

## 7. openai.ts

- Add `boundaryBatch(fragTexts, cfg, apiKey, signal): Promise<{content, finishReason}>`
  using `fillBoundaryPrompt`. Same transport as `translateBatch`/`segmentBatch`.
- Remove/repurpose the old `segmentBatch` (range-based) — no longer used.
- `translateBatch`/`translateRange` untouched (pass 2 + fallback rely on them).

## 8. Edge cases

- 1 fragment → isEnd=[true] → one sentence.
- Pass 1 fails (bad/short output) after retries → fallback to 1:1.
- Pass 2 truncates → adaptive split inside `translateRange`; if it still fails →
  propagates → fallback to 1:1.
- Abort → propagates, no fallback, no write.
- Overlapping/estimated fragment durations → handled by the next-start time clamp.
- `src===tgt` short-circuit stays in `main.ts`.

## 9. Testing

- `segment.test.ts`: `parseBoundaries` (valid E/C, missing fragment → throws, forces
  last=E); `groupByBoundaries` (single, multiple, all-continue → one sentence);
  `sentencesToCues` time clamp (non-last clamps to next start; last uses raw end;
  joined o; asserts translation count).
- `pipeline.test.ts` (mock `gmFetch`, TWO calls per happy path): boundaries+translate
  → sentence-cues with clamped spans; pass-1 bad output → **fallback to 1:1** (N
  fragment cues); pass-2 truncation → split → completes; abort → reject no fallback.
- `clean.test.ts` unchanged. Keep fake timers.

## 10. Rollout
Single change, ship in one feat commit (+tests). No schema/pool migration. The
previous misaligned pool entries get overwritten on re-translation (out of scope to
force). Two LLM calls per fresh video (boundaries + sentences); DeepSeek one-shot
both — cost acceptable. Very-long videos on tiny-output models fall back to 1:1.
