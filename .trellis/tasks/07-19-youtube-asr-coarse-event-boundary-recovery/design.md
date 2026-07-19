# Design — YouTube ASR boundary recovery and runtime version logging

## 1. Data flow

```text
YouTube JSON3 + selected track kind
  -> parseTimedtext
       manual                 -> legacy authored events
       ASR + dense offsets    -> word-timed fragments with natural ends
       ASR + sparse/no offsets-> coarse event punctuation fragments
  -> cleanCues
  -> deterministic sentenceEnd flags or boundary model
  -> buildSentencePlans safety gate
  -> translation/alignment/cache
```

The parser owns source timing fidelity. The sentence safety gate remains an
independent consumer and must not compensate for a lossy parser by accepting
false long sentences.

## 2. Runtime version log

Import `GM_info` from vite-plugin-monkey's `$` virtual module and log only
`GM_info.script.version`:

```text
[Gistlate] Script v0.2.17 loaded on YouTube
```

The semantic version comes from the installed userscript metadata, so it
describes the currently injected instance rather than `package.json` in the
source checkout. The existing `[Gistlate]` prefix remains stable.

## 3. Word-timed natural-end contract

Extend the internal `TimedFragment` with an exclusive natural end `e`:

```ts
interface TimedFragment {
  s: number
  e: number
  o: string
  sentenceEnd: boolean
}
```

For each event:

1. Compute `reportedEventEnd = tStartMs + (dDurationMs ?? 4000)`.
2. Find the next visible event start.
3. Bound the current event's natural end to the earlier of its reported end and
   next visible start when both exist.
4. A token with a later explicit segment offset ends at that offset. The last
   token ends at the bounded natural event end, not an arbitrarily distant next
   event.
5. A sentence boundary inside one packed segment receives a proportional
   boundary time over that token's bounded interval.
6. Final cue duration is bounded by both its natural end and the next fragment
   start. Gaps are preserved; overlaps are not.

This retains exact adjacent behavior for ordinary ASR while fixing the long
silence case.

## 4. Coarse ASR punctuation adapter

Keep `parseLegacyEvents` as the compatibility path for manual/unknown sparse
tracks. Add a distinct coarse-ASR adapter for an explicitly selected ASR track
when dense word timing is unavailable.

The adapter reuses the established legacy event merge and duration rules, then
splits the normalized event text at `isSentenceBreak` positions. Each split is
assigned a proportional start/end inside the event's bounded duration. The
trailing unpunctuated fragment is `sentenceEnd: false`; punctuation fragments
are true. The final visible fragment is forced true so complete coverage is
possible.

This makes internal boundaries expressible before the E/C model contract. It
does not invent punctuation and does not apply to manual tracks.

## 5. Invariants

- Cue starts are strictly increasing.
- Cue durations are positive.
- Cue ranges never overlap; real silence may remain uncovered.
- Concatenated fragment text equals the event text after the same whitespace
  normalization already applied by legacy parsing.
- Every deterministic ASR cue owns a boolean `sentenceEnd`.
- Persisted translated artifacts still omit internal `sentenceEnd`.

## 6. Validation strategy

The primary regression seam is `parseTimedtext`, using JSON3-shaped fixtures:

- dense offsets + long inter-event silence;
- explicitly ASR sparse/no offsets + several sentence marks in one event;
- unknown/manual variants proving compatibility;
- existing packed-event and Japanese fixtures.

An integration assertion carries the long-silence parser output through
`groupByBoundaries` and `buildSentencePlans`, reproducing the original safety
gate rather than testing only a helper.

Distribution validation inspects the built metadata/log text and verifies the
single-IIFE/Trusted-Types constraints.

## 7. Rollback

The change is internal and schema-free. Reverting the parser/log commit restores
the prior behavior without cache migration. Existing L1/L2 artifacts remain
readable.

## 8. Debug retrospective

### 8.1 Root-cause categories

- **B — Cross-layer contract:** `TimedFragment` preserved a start, text and
  sentence flag but discarded the natural speech end before `Cue` construction.
  Sentence planning therefore received silence represented as spoken duration.
- **E — Implicit assumption:** the adapter assumed a useful subtitle timeline
  must be gap-free and that `nextFragment.s` was always the correct prior end.
- **D — Test coverage gap:** packed-event tests asserted monotonic/minimum
  duration but did not include a short punctuated event followed by a long
  silence or pass that result through the sentence safety gate.
- **B/E for coarse events:** the E/C boundary API can express only cue-tail
  decisions, while the legacy adapter assumed one provider event was an
  adequate boundary atom even when its text already contained several stops.

### 8.2 Why earlier fixes were insufficient

1. Preserving word offsets and `sentenceEnd` fixed internal boundary loss but
   still collapsed every inter-fragment gap into the previous cue duration.
2. Raising the valid English character ceiling from 240 to 480 correctly
   accepted real dense narration, but duration-only false sentences remained.
3. The 30-second safety gate detected both defects; changing it would only hide
   invalid upstream timing/boundaries and produce visible audio drift.

### 8.3 Prevention mechanisms

| Priority | Mechanism | Specific action | Status |
|---|---|---|---|
| P0 | Architecture | Store natural exclusive end on every internal timed fragment | Done |
| P0 | Adapter contract | Split explicit punctuation in selected coarse ASR before cue-level E/C | Done |
| P0 | Integration tests | Replay long silence through parsing and sentence planning | Done |
| P1 | Real replay | Revalidate `Ru7H092hFAI` source/count/plan bounds | Done |
| P1 | Observability | Log the injected `GM_info.script.version` | Done |
| P1 | Documentation | Capture gap/coarse-ASR rules in frontend and cross-layer specs | Done |

### 8.4 Systematic expansion

- Subtitle search, `findCueAt`, SRT and overlay code must continue to treat a
  gap as legitimate absence, not malformed coverage.
- Timeline-compatible cache checks may reject old gap-stretched artifacts;
  that is a safe miss and avoids replaying known audio drift.
- Any future timestamp normalizer must test value conservation, monotonicity,
  non-overlap, natural end preservation and a long idle interval separately.
