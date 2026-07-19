# Design: semantic-aligned progressive subtitle translation

## 1. Summary

Replace the current whole-video translation of display-capped partial clauses
with a complete-sentence job pipeline. Translation produces immutable canonical
target sentences; a separate alignment pass returns cut positions used to map
those translations onto short source-timed display ranges. The same jobs run in
sentence, configurable batch, or whole mode and can update fresh subtitles
progressively without persisting partial artifacts.

Every successful DeepSeek response contributes normalized usage to an operation
collector. A successful artifact stores its generation usage/cost; a separate
local ledger preserves lifetime per-video totals and bounded recent operation
details, including failed and aborted work.

## 2. Hard invariants

1. A complete source sentence is the minimum independently translated unit.
2. A canonical target sentence belongs to exactly one source sentence and is
   immutable after translation succeeds.
3. Display alignment may choose only strictly increasing, word-safe cut
   positions in the canonical target string. It cannot rewrite target text.
4. Target display slices concatenate exactly to the canonical translation.
5. Source fragments are covered exactly once, contiguously, in source order.
6. Emitted cues remain sorted, non-empty, and non-overlapping.
7. Progressive partial results are display-only. L1/L2 receive one complete,
   validated artifact or nothing.
8. Force retranslation never mixes old and new cue segmentation in Store.
9. Every returned provider usage payload is decoded and counted once, before
   content validation/retry decisions.
10. `completion_tokens_details.reasoning_tokens` is a subset of
    `completion_tokens`; cost never double-counts it.
11. A canonical target must pass target-language/source-echo/completeness
    validation before it can enter a SentenceJob or cache.

## 3. End-to-end data flow

```text
YouTube timedtext response
  -> require request v === current watch videoId
  -> parseTimedtext + cleanCues
  -> cleaned source fragments
       word-timed Google ASR: recover tOffsetMs fragments + sentenceEnd hints
       untimed/manual captions: preserve legacy event cues
  -> boundary method
       all sentenceEnd hints: local timed-punctuation flags (zero API calls)
       otherwise: DeepSeek E/C request (thinking enabled/high)
  -> validated E/C flags
  -> complete SentenceRange[]
  -> SentencePlan[]
       sourceRange
       canonical sourceText
       capped source displayRanges/displayTexts
  -> stable whole-video reference prefix
  -> request grouping by mode
       sentence: 1 plan/request
       batch:    N plans/request (2..32, default 8)
       whole:    all plans/request
  -> canonical target translation Map<sentenceId, string>
  -> per-sentence target alignment when displayRanges.length > 1
       immutable canonical target + source display chunks
       -> cut positions only
       -> validate/slice locally
       -> bounded correction retries
       -> full-sentence long-cue fallback on exhaustion
  -> completed SentenceJob translated cues
  -> assemble all jobs in source order
       fresh: progressive memory-only Store updates
       force: keep old Store result until full completion
  -> full validation
  -> put L1 once
  -> attempt L2 once
```

Parallel usage flow:

```text
each HTTP 200 completion response
  -> decode provider usage once
  -> operation UsageCollector.add(stage, usage)
  -> persist/update local running ledger operation
  -> then parse/validate content

operation terminal state
  -> finalize local ledger status success|failed|aborted
  -> if success, embed aggregate + price snapshot in artifact metadata
```

## 4. Domain contracts

### 4.0 Timed ASR sentence recovery

Use the word-timed path only when `tOffsetMs` is present on a clear majority of
visible segments and at least one event contains multiple visible segments.
Expand absolute segment starts as `event.tStartMs + inferredOrExplicitOffset`.
Infer only sparse missing offsets: first missing offset is zero, interior gaps
interpolate between known neighbors, and trailing gaps use the median known step
or 200 ms. Explicit offsets are never rewritten.

Skip pure newline `aAppend` events, retain real appended text, split after
`.!?。！？`, and keep ordinary Google event boundaries as continuing fragments.
If the next event begins with a sentence mark, attach it to the previous
fragment. Preserve every cleaned source character, force the final hint to end,
and emit positive, sorted, non-overlapping cue times. Manual/untimed tracks use
the unchanged legacy parser.

### 4.1 Translation settings

Add a translation-owned settings group:

```ts
export type TranslationMode = 'sentence' | 'batch' | 'whole'

export interface TranslationSettings {
  mode: TranslationMode
  /** Remembered even when another mode is active. Valid range 2..32. */
  batchSize: number
}
```

Defaults:

```ts
translation: {
  mode: 'sentence',
  batchSize: 8,
}
```

`mergeDefaults` accepts only the three mode literals and clamps/normalizes an
integer batch size into 2..32. Old stored settings receive defaults. The settings
panel shows the batch-size input only when `mode === 'batch'` and explains that
the strategy affects fresh/force translation, not existing cache hits.

### 4.2 Sentence plan and job

Add a translation-owned plan contract, tentatively in `translate/jobs.ts`:

```ts
export interface SentencePlan {
  id: string                    // stable global ID, e.g. S001
  sourceRange: SentenceRange    // complete sentence
  sourceText: string            // joined complete source sentence
  displayRanges: SentenceRange[]
  displayTexts: string[]
}

export type SentenceJobStatus =
  | 'pending'
  | 'translating'
  | 'aligning'
  | 'done'
  | 'failed'

export interface SentenceJob {
  plan: SentencePlan
  status: SentenceJobStatus
  canonicalTarget?: string
  translatedCues?: Cue[]
  alignmentFallback?: boolean
  error?: Error
}
```

`buildSentencePlans(fragments, completeRanges)` calls the existing display-range
cap for each complete range but preserves both levels instead of flattening them
into translation units. It validates:

- plans cover every complete range once;
- display ranges cover each plan's source range exactly once;
- global source coverage remains contiguous and ordered;
- every source/display text is non-empty.
- no complete sentence exceeds 30 seconds, 480 source code points, or three
  terminal sentence marks; such a range indicates failed boundary recovery and
  is rejected before display capping or translation. The character cap is an
  emergency collapsed-timing guard: real `5zKyUcKU134` English ASR reaches 321
  code points in a valid single-stop sentence, so it must not act as a display
  length target.

### 4.3 Canonical translation response

Use stable global sentence IDs in every mode. The parser accepts exactly the
requested ID set, one non-empty target per ID, with no duplicates or extras:

```ts
type CanonicalTranslations = Map<string, string>
```

Do not renumber each request locally. Global IDs make out-of-order concurrent
responses and diagnostics unambiguous.

After exact ID parsing, validate every canonical target before it enters the
job: reject normalized source echoes/long source prefixes, kana-heavy zh-Hans,
common Traditional-only zh-Hans characters, severe long-source compression, and
missing punctuation coverage for a multi-sentence source. Treat validation as a
retryable structured-response error. Append only the compact error at the
changing prompt tail so the immutable transcript prefix remains cacheable.

Completeness is a conservative omission signal, not a fluency score. For a long
Latin-dominant source translated to `zh-Hans`, compare target content code points
with Latin source word count and reject only below `0.4` target code points per
source word. Raw source/target comparable-code-point ratio `0.28` remains the
fallback for other directions. Include only bounded counts in the error so live
logs expose the active scale without logging the rejected translation or prompt.

### 4.4 Target alignment response

Prefer JSON output for official DeepSeek:

```json
{
  "S017": [14, 29]
}
```

For a sentence with K source display ranges, require K-1 cuts. A shared decoder
normalizes the provider response to:

```ts
type AlignmentCuts = Map<string, number[]>
```

Validation per sentence:

- response contains the requested sentence ID and no unexpected IDs;
- cut count is exactly `displayRanges.length - 1`;
- each cut is a safe JavaScript string/code-point boundary chosen by one
  centralized indexing contract;
- no cut is inside a Latin/ASCII product token, between adjacent Han characters,
  or immediately before closing punctuation;
- cuts are integers, strictly increasing, and `0 < cut < targetLength`;
- all slices are non-empty;
- rejoining slices equals `canonicalTarget` exactly.

Use Unicode code-point indexing rather than UTF-16 code-unit indexing in both
prompt instructions and local slicing. One helper owns conversion/slicing so an
emoji or supplementary character cannot invalidate offsets.

No alignment request is needed when `displayRanges.length === 1`.

### 4.5 Alignment fallback

An alignment attempt receives up to two validation-guided corrective retries
(three attempts total). The immutable input prefix stays unchanged; the compact
validation failure is appended at the tail for cache reuse.

Before the first request, enumerate locally valid structural cut positions. If
their count is lower than `displayRanges.length - 1`, no model response can pass
the validator: skip all alignment calls and use the same fallback immediately.
This optimization never chooses a cut or guesses semantic alignment.

If all attempts fail:

```ts
{
  s: firstFragment.s,
  d: safeFullSentenceDuration,
  o: plan.sourceText,
  t: canonicalTarget,
}
```

The full-sentence duration uses the same next-sentence/gap-tolerance clamp as
normal cue assembly. This is a valid successful job, increments an alignment
fallback diagnostic counter, and never performs proportional target guessing.

## 5. Prompt and cache-prefix design

### 5.1 Boundary request

If every source Cue has a boolean `sentenceEnd`, use those flags locally and
record `boundaryMethod: timed-punctuation`, `boundaryRequestCount: 0`, and
`boundaryThinking: not-used`.

Otherwise retain the full-fragment E/C boundary contract. For recognized
official DeepSeek V4 models send:

```json
{
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

Do not send `temperature` or `top_p` in thinking mode.

### 5.2 Stable reference prefix

All translation requests share this exact beginning:

```text
fixed translation system prompt
normalized title/description context
IMMUTABLE REFERENCE TRANSCRIPT
[S001] complete source sentence
[S002] complete source sentence
...
END IMMUTABLE REFERENCE TRANSCRIPT
```

Only the tail changes:

```text
TARGET IDS: S017, S018, ...
Translate only the requested complete sentences.
```

The target selector must remain after the complete stable reference. Never put
the changing batch ID/count into the system prompt or before the transcript.

For recognized official DeepSeek V4 translation calls send:

```json
{
  "thinking": { "type": "disabled" },
  "temperature": 0
}
```

Leave `top_p` absent/default. For providers that do not support DeepSeek-specific
fields, omit `thinking`; the generic Chat Completions translation profile may use
temperature 0 only when supported. The OpenAI Responses branch keeps its current
provider-compatible parameter surface.

### 5.3 Alignment prompt

Alignment receives the stable source reference plus a target tail containing:

- requested sentence ID;
- complete source sentence;
- numbered source display chunks;
- immutable canonical target sentence;
- required cut count;
- optional previous validation error on correction attempts.

It explicitly forbids rewriting and requests code-point cut offsets only. Use
DeepSeek non-thinking mode, temperature 0, and JSON output.

## 6. Request modes and scheduling

### 6.1 Grouping

One pure grouping function owns all modes:

```ts
groupPlans(plans, mode, batchSize): SentencePlan[][]
```

- sentence -> groups of 1;
- batch -> contiguous groups of clamped N;
- whole -> one group containing all plans.

If a group returns truncation/count mismatch after bounded retries, it may split
adaptively into contiguous halves. Record requested strategy and actual request
count; adaptive recovery never changes sentence ownership.

### 6.2 Cache warm-up and concurrency

Use one internal concurrency constant initially set to 8. It is not user-facing
in this task.

1. Select the pending group covering the current playhead (or first group).
2. Run it alone to populate the stable prefix cache.
3. Start the remaining queue with concurrency <= 8.
4. Choose the next pending group at dequeue time using current playhead distance,
   preferring current/upcoming speech over past/far content.
5. On seek, update the scheduler playhead; do not abort already-running requests,
   but reprioritize work not yet started.

Whole mode naturally has one translation group and cannot progressively expose
canonical translations before that response completes. Alignment may still run
afterward, but the UI performs one final whole-video update by mode contract.

### 6.3 Progressive callbacks

Extend pipeline/resolve options with typed callbacks, for example:

```ts
interface TranslationProgress {
  stage: 'boundaries' | 'translating' | 'aligning'
  completedSentences: number
  totalSentences: number
  cues: Cue[]
}

interface ResolveOptions {
  // existing fields...
  onProgress?: (progress: TranslationProgress) => void
  getCurrentTime?: () => number
}
```

Fresh cache miss:

- pending plans contribute their source display cues with `t` absent;
- completed plans contribute their validated translated cues;
- assemble by source range on every progress event;
- `main.ts` installs the memory-only working cues in Store.

Force retranslation:

- do not pass a Store-mutating progress callback;
- progress/status count may still update;
- old complete Store cues remain until resolve returns a full replacement.

## 7. Store and overlay behavior

Keep Store as the state owner but make subtitle updates observable. `setSubtitle`
must notify subscribers using the current playhead, rather than requiring callers
to fake a time update after every progress event.

The working cue array is always globally sorted and binary-search-safe.

Pending cue display:

- bilingual mode: original visible, translated line hidden;
- translation-only mode: temporarily show original text in the primary visible
  line when `t` is absent, then switch to target when available.

`status.ts` gains progress rendering such as:

```text
Gistlate 正在分析字幕结构…
Gistlate 已翻译 17 / 96
Gistlate 正在对齐 17 / 96
```

No new persistent player control is added.

## 8. Persistence and generation metadata

### 8.1 Cache entry compatibility

Keep cache key/path and cue schema unchanged. Extend `CacheEntry` with optional
backward-compatible metadata:

```ts
interface GenerationMetadata {
  strategy: {
    mode: TranslationMode
    configuredBatchSize: number
    effectiveRequestCount: number
    concurrency: number
    temperature: number
    boundaryMethod: 'timed-punctuation' | 'llm'
    boundaryRequestCount: number
    boundaryThinking: 'enabled' | 'not-used'
    translationThinking: 'disabled'
  }
  alignment: {
    requestCount: number
    fallbackSentenceCount: number
  }
  usage?: TranslationOperationUsage
  pricing?: PricingSnapshot
  costCny?: number
}

interface CacheEntry {
  // existing fields...
  video?: { title?: string }
  generation?: GenerationMetadata
}
```

Old entries deserialize normally. Normal cache hits ignore the current strategy.
Force retranslation uses live settings and overwrites the same entry only after
full success.

### 8.2 Complete-only persistence

`resolveTranslation` remains the only L1/L2 persistence boundary:

1. cache reads unless force;
2. begin usage operation only on genuine translation;
3. run pipeline/progress;
4. re-check abort/staleness;
5. validate all final cues translated;
6. create artifact with generation metadata;
7. put L1 once;
8. attempt L2 once;
9. finalize operation success.

Failure/abort finalizes the local ledger but writes no subtitle artifact.

## 9. Usage decoding, pricing, and ledger

### 9.1 Shared provider usage decoder

Add a single owner, tentatively `usage/contracts.ts`:

```ts
interface RequestUsage {
  promptTokens: number
  promptCacheHitTokens: number
  promptCacheMissTokens: number
  completionTokens: number
  reasoningTokens: number
  totalTokens: number
}
```

Decode untrusted provider JSON defensively. Enforce non-negative finite integers;
derive only relationships that are unambiguous. Missing usage yields `undefined`,
not zero. Preserve compatibility with providers that return only prompt,
completion, and total tokens.

`callChatAPI` returns `{content, finishReason, usage}`. The caller emits usage to
the collector immediately after HTTP success and before output parsing. Do not
log prompts or `reasoning_content`.

### 9.2 Usage collector

One collector instance belongs to one video translation operation. It owns stage
aggregates (`boundary`, `translation`, `alignment`) plus total and request/status
counts. Concurrent additions are serialized through its ledger sink.

The collector must receive each HTTP response usage once. Retry wrappers never
re-add the same completion object.

### 9.3 Pricing snapshot

Add centralized pricing detection, tentatively `usage/pricing.ts`:

```ts
deepseek-v4-flash: hit 0.02, miss 1, output 2 CNY / 1M
deepseek-v4-pro:   hit 0.025, miss 3, output 6 CNY / 1M
```

Apply only when the normalized URL hostname is `api.deepseek.com` and model is an
exact recognized ID. Store currency, per-million rates, and snapshot timestamp.
Unknown providers retain tokens with undefined cost.

Cost formula:

```text
hit/1M * hitRate + miss/1M * missRate + completion/1M * outputRate
```

Never add reasoning tokens separately.

### 9.4 Separate usage database

Use a separate IndexedDB database (e.g. `gistlate-usage`, version 1) rather than
upgrading/entangling the subtitle cache DB. This keeps `clearL1()` from clearing
usage history and avoids a migration of the existing `gistlate` DB.

Stores:

```text
totals      keyPath videoId     exact lifetime aggregate
operations  keyPath operationId recent operation detail
```

Useful operation indexes: `videoId`, `endedAt`, `status`.

Persist a running operation before the first API call. Update its aggregate when
usage responses arrive so a later page crash loses as little billed usage as
possible. Finalize with success/failed/aborted. On next initialization, reconcile
stale `running` records as aborted without fabricating new usage.

Retention:

- lifetime totals remain until an explicit usage-history clear action;
- retain newest 20 operation details per video;
- retain newest 2,000 operation details globally;
- pruning details never subtracts totals;
- subtitle-cache clearing never clears usage history.

## 10. Timedtext identity guard

Before parsing or mutating handled-track state:

```ts
const requestVideoId = params.get('v')
if (!requestVideoId || requestVideoId !== getVideoId()) return
```

This prevents a late SPA timedtext response from being stored under the next
watch URL. Keep existing duplicate-track suppression after this guard.

## 11. Error matrix

| Condition | Behavior |
|---|---|
| Cache hit | return immediately; no usage operation/cost |
| Timed-punctuation source hints | use local flags; zero boundary requests/reasoning cost |
| Boundary malformed after retries | fail operation; no partial translation cache |
| Boundary creates >30s/>480-code-point/>3-stop sentence | fail operation; do not cache the false sentence |
| Translation group truncated/count-invalid | retry, then adaptively split group |
| Canonical target echoes source/wrong script/severely incomplete | retry with correction tail, then split/fail closed |
| Single-sentence translation still fails | mark failed; continue display of other fresh results; final operation fails/no artifact |
| Alignment invalid | append validation error and retry up to two times |
| Target has fewer safe positions than required cuts | immediate full-sentence fallback; zero alignment calls |
| Alignment retries exhausted | emit safe full-sentence long cue; count fallback |
| Seek | reprioritize pending groups only |
| Navigation/user abort | abort in-flight, discard fresh working result, ledger status aborted, no artifact |
| Force translation failure | keep old complete Store/cache, ledger status failed |
| L1 write failure | operation fails; do not claim/store successful artifact metadata |
| L2 write failure | keep successful L1 result; existing soft-fail policy |
| Provider usage missing | translation may succeed; record tokens/cost unavailable |
| Unknown model/provider | raw usage only, no fabricated CNY |

## 12. Testing strategy

### Pure/unit

- settings merge: old settings, all modes, invalid mode, batch clamp/default;
- sentence plans: complete vs display ranges, exact coverage, long fragment;
- word-timed parser: internal event punctuation, next-event punctuation,
  sparse-offset legacy fallback, exact source preservation, positive ordering;
- global-ID translation parser: exact IDs, duplicate/missing/extra/empty;
- canonical target validator: source echo/prefix, kana-heavy, Traditional-only,
  severe omission, valid Simplified Chinese, naturally compressed Latin-to-Han
  translations, and a first-clause-only English-to-Chinese target;
- alignment parser: valid cuts, wrong count, unordered, non-integer, out of range,
  Unicode code points, exact target reconstruction, unsafe Latin/Han/punctuation
  cuts;
- long-cue fallback timing and diagnostics;
- impossible-safe-cut preflight: zero alignment requests and one fallback;
- grouping: sentence/batch/whole and adaptive split;
- priority selection around playhead and seek;
- usage decoder: full DeepSeek payload, reasoning subset, missing/invalid fields;
- pricing: Flash/Pro official URL, unknown proxy/model, exact formula;
- usage aggregate: stages, concurrent responses, retries counted once;
- ledger: success/fail/abort, lifetime totals, 20-per-video and 2,000-global
  pruning, stale running reconciliation, cache clear independence.

### Pipeline/integration with mocked API

- boundary -> complete plans -> per-sentence translations -> alignment cuts ->
  progressive ordered cues -> final cues;
- timed-punctuation hints bypass boundary transport and record zero requests;
- a canonical source-copy response is rejected and corrected on retry;
- reproduce `vvLnNHtY09U` anchor pattern with recorded source/target fixtures and
  prove a canonical sentence cannot be assigned to its neighbor;
- sentence mode first result appears before full completion;
- batch mode updates by batch; whole mode updates once;
- out-of-order responses still assemble source order;
- seek changes the next pending request;
- alignment invalid three times -> safe long cue;
- parse-invalid response usage counted before retry;
- abort/failure writes no L1/L2 but finalizes ledger;
- force mode emits progress status but leaves Store unchanged until success.

### Build/manual

- `pnpm compile`
- `pnpm test`
- `pnpm build`
- verify one IIFE and no SystemJS/dynamic imports;
- use real DeepSeek usage response and compare recorded aggregate with provider
  fields/request count;
- run `vvLnNHtY09U` in sentence mode, confirm progressive display and semantic
  anchors at 17.720–32.559 seconds;
- compare sentence/batch(8)/whole by force retranslation and inspect strategy,
  actual cost, cache hit rate, first-result latency, full latency, and fallback
  count;
- overwrite or remove the known-bad pool artifact only after a verified result.

## 13. Rollout and rollback

Default new/merged settings to sentence mode. Keep all modes selectable for
controlled comparison. Existing cached artifacts remain readable and are not
automatically regenerated.

Rollback is schema-light:

- strategy can be forced to whole/sentence without changing cache identity;
- progressive Store callback can be disabled while retaining final results;
- alignment can safely fall back to full sentence cues;
- optional generation/usage metadata is ignored by older readers;
- usage DB is independent and can remain even if the feature is disabled.

The known-bad `vvLnNHtY09U` artifact is repaired only after real verification;
force retranslation overwrites it atomically through the existing path.

## 14. Debug retrospective: structurally valid but semantically wrong captions

### 14.1 Root-cause categories

- **B — Cross-layer contract:** JSON3 segments carried word/symbol time, but the
  timedtext adapter exposed only event-level text/time. Later boundary logic
  could not express an internal sentence end.
- **E — Implicit assumption:** the pipeline treated one Google event as an
  adequate atomic source fragment and treated valid IDs/reversible target cuts
  as evidence of semantic quality.
- **D — Test coverage gap:** fixtures checked count, coverage, order, and exact
  target reconstruction, but not a real event containing two sentences,
  source-copy Japanese, Traditional output, or cuts inside product/CJK words.

### 14.2 Why earlier fixes were insufficient

1. Complete-sentence ownership fixed cross-ID drift only after boundary ranges
   existed; it could not recover a boundary that the adapter had erased.
2. Exact canonical IDs proved response structure, not that the value was in the
   target language or complete.
3. Exact cut reconstruction proved reversibility, not semantic word safety.
4. Full-sentence fallback was safe only if the source range was a true sentence;
   four `Ru7H092hFAI` ranges were actually 42–94 second multi-sentence blocks.

### 14.3 Prevention mechanisms

| Priority | Mechanism | Action | Status |
|---|---|---|---|
| P0 | Architecture | Preserve usable `tOffsetMs` and typed `sentenceEnd` through source planning | Done |
| P0 | Runtime validation | Reject false mega-sentences, bad canonical targets, and unsafe cuts | Done |
| P0 | Regression replay | Verify real JSON3 source equality, plan count, and maximum duration | Done |
| P1 | Observability | Persist boundary method/request count and truthful thinking state | Done |
| P1 | Documentation | Record lossy-adapter and semantic-validation contracts in frontend/cross-layer specs | Done |

### 14.4 Systematic expansion

- Untimed/manual tracks still require the boundary model, so hard sentence limits
  remain a provider-independent fail-closed guard.
- Other target languages still receive generic echo/completeness checks; the
  kana/Traditional checks remain scoped to `zh-Hans`.
- Internal source types may be richer than `{s,d,o,t}`. Compatibility belongs at
  the final artifact boundary, not in the parser's fidelity.

## 15. Debug retrospective: legitimate high-density English ASR

### 15.1 Root-cause category

- **E — Implicit assumption:** the independent 240-code-point limit assumed a
  valid spoken sentence could not be longer, conflating translation ownership
  with the much shorter display-range target.
- **D — Test coverage gap:** the safety tests contained only a minute-long,
  multi-stop synthetic paragraph and did not sample the upper tail of a real
  English ASR sentence-length distribution.

### 15.2 Why a narrow fix would fail

1. Raising 240 to 244 would pass sentence 21 but later fail at the same video's
   valid 284-, 300-, and 321-code-point sentences.
2. Excluding whitespace would still reject two valid sentences with 247 and 260
   non-whitespace code points.
3. Splitting at commas would weaken complete-sentence ownership and recreate the
   semantic-cross-line risk this pipeline exists to prevent.

### 15.3 Prevention mechanisms

| Priority | Mechanism | Action | Status |
|---|---|---|---|
| P0 | Test coverage | Preserve the real 243/321-character English sentences as plan regressions | Done |
| P0 | Runtime validation | Use a 480-code-point emergency cap while retaining 30s/3-stop guards | Done |
| P1 | Documentation | State that display capping, not owner rejection, handles readable length | Done |

### 15.4 Systematic expansion

- Safety thresholds derived from one language or synthetic data require a real
  distribution check before becoming independent fail-closed conditions.
- Runtime guards should identify corrupted structure; ordinary large but valid
  units should flow into the layer already responsible for display refinement.

## 16. Debug retrospective: cross-script completeness ratios

### 16.1 Root-cause category

- **E — Implicit assumption:** the canonical completeness gate compared raw
  source and target code-point counts as though Latin text and Han text encoded
  meaning at similar character density.
- **D — Test coverage gap:** the validator had Japanese-to-Chinese and synthetic
  severe-summary cases, but no real English-to-Chinese compression examples or
  pipeline assertion that a complete concise target succeeds without retries.

### 16.2 Why the earlier guard failed

1. A universal `target/source >= 0.28` threshold translated average English
   word length directly into a Chinese-output quota unrelated to semantic
   completeness.
2. Temperature-zero correction retries could not help: a valid concise target
   remained below the same invalid threshold on every attempt.
3. Removing the gate would permit genuine summaries and partial translations;
   the defect was the measurement scale, not the fail-closed policy.

### 16.3 Prevention mechanisms

| Priority | Mechanism | Action | Status |
|---|---|---|---|
| P0 | Runtime validation | Use Latin source word count for Latin-dominant long source to zh-Hans | Done |
| P0 | Test coverage | Preserve all five live sources, concise complete targets, and a first-clause-only rejection | Done |
| P0 | Integration | Assert the real S092-shaped pipeline job succeeds in one translation request | Done |
| P1 | Observability | Add bounded target-code-point/source-word counts to completeness failures | Done |
| P1 | Documentation | Forbid universal raw-length ratios across scripts in the frontend quality contract | Done |

### 16.4 Systematic expansion

- Any heuristic comparing translated text length must identify the language
  direction or script density before selecting units and thresholds.
- Thresholds remain corruption detectors, not quality scores. New directions
  need paired complete and deliberately incomplete real examples before gaining
  a specialized branch.
- Stable deterministic retries amplify validator false positives; retry prompts
  cannot compensate for a local predicate that rejects valid output.
