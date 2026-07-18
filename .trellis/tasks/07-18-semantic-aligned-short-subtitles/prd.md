# Semantic-aligned short subtitle translation

## Goal

Keep translated subtitles short enough to read while guaranteeing that every
displayed target-language chunk belongs to the source speech covered by the
same cue time range. Fix the real `vvLnNHtY09U` regression where structurally
valid Chinese cues progressively contain the following Japanese cue's meaning.

## User Value

- Translation remains synchronized with the spoken content instead of merely
  having valid, ordered timestamps.
- Long Google ASR sentences can still be presented as readable subtitle chunks.
- A bad shared artifact can be explicitly regenerated and overwritten after the
  alignment fix is verified.

## Confirmed Facts and Constraints

- Only the owner currently uses the online artifact pool. Experimental changes
  and temporary bad results are acceptable; a rollback-only hotfix is not
  required.
- The user proposes replacing one whole-video translation request with multiple
  smaller translation batches. Each batch may carry the same stable whole-video
  context so later requests receive a high DeepSeek prefix-cache hit. This is
  distinct from retrying an unchanged whole-video request multiple times.
- The failing artifact is
  `vvLnNHtY09U|ja|zh-Hans`, translated by `deepseek-v4-flash` into 204 cues.
- Its JSON shape, cue ordering, timestamps, and non-empty fields are valid, but
  semantic inspection proves that Chinese content begins appearing one cue
  before the matching Japanese content around 17.7 seconds and continues to
  drift in that pattern.
- The source transcript clearly belongs to the expected Gundam Marker / partial
  painting video, so stale cross-video capture is not the primary cause in this
  incident.
- The pre-task pipeline detected complete sentence ranges, then called
  `capSentenceRanges` before translation. The cap re-splits complete sentences
  into display-sized partial clauses, and the numbered translator can move
  meaning across those lines while still returning every required number.
- Number/count validation cannot prove semantic line alignment.
- A later `yt-dlp` audit of `Ru7H092hFAI` retrieved Google's `ja-orig` JSON3.
  Its 309 text events contain 3,211 word/symbol segments and 308/309 events have
  `tOffsetMs`; 135 events contain an internal sentence end followed by the next
  sentence. The pre-fix parser discarded those offsets and made each whole
  event one Cue, so the boundary model cannot express most true sentence ends.
- The cleaned JSON3 source and the pool artifact source are exactly equal at
  5,618 characters. Source capture, cleanup, ordering, and video identity are
  therefore not the cause of the `Ru7H092hFAI` drift.
- Translation title/description context, force retranslation, abort behavior,
  full-success cache writes, and the compact stored cue schema `{s,d,o,t}` must
  continue to work.
- This task may change internal types and prompts but should avoid an L1/L2 data
  migration unless evidence proves one is necessary.
- Minimal recovery of sentence/display fragments from Google-provided
  `tOffsetMs` is in scope because otherwise true sentence boundaries inside an
  event are inexpressible. Statistical word-boundary inference (MAD/Z-score),
  tokenization of untimed tracks, and arbitrary intra-word splitting remain in
  the separate word-level task.
- The supplied DeepSeek-V3/V4 tokenizer counts the failing artifact at 5,677
  tokens for the 204 numbered Japanese source cues and 3,526 tokens for the 204
  numbered visible Chinese outputs. With current prompts and title-only context,
  the translation input is 6,066 tokens; a 204-cue boundary-input proxy is 5,838
  tokens with about 1,019 visible E/C output tokens.
- DeepSeek-V4 thinking mode is enabled by default. The current OpenAI-compatible
  request body does not send `thinking`, so hidden reasoning output is an
  unbounded cost/latency variable when translation is divided into many calls.
- The user approved keeping thinking enabled for boundary detection when the
  source has no deterministic timed-punctuation hints, while explicitly
  disabling thinking for all translation batches. Word-timed Google ASR uses
  local punctuation hints and sends no boundary request.
- The user approved deterministic sampling for constrained translation:
  translation and target-alignment requests use `temperature: 0` with provider
  default `top_p`; the thinking-enabled boundary request sends neither sampling
  parameter. A later increase to `0.2` or `0.3` requires real-video evidence of
  materially worse fluency at zero temperature.
- The user approved progressive display as part of this task. On a fresh cache
  miss, completed sentence results appear immediately while the remaining video
  continues translating. Progressive results remain memory-only until the full
  artifact succeeds. Explicit force retranslation keeps the complete old result
  visible and switches atomically only after the replacement is complete.
- The user approved three selectable translation request strategies sharing the
  same complete-sentence and `<CUT>` invariants: `sentence` (one complete sentence
  per request), `batch` (configurable N complete sentences per request), and
  `whole` (all complete sentences in one request). Default mode is `sentence`;
  the remembered/default batch size is 8.
- The user approved two-layer cost retention: each successful artifact stores
  the measured usage/cost of the operation that produced it, while a local
  append-only usage ledger retains every operation for that video, including
  successful generations, failed attempts, navigation/user aborts, and force
  retranslations.
- The user selected a separate target-alignment pass. Translation first produces
  one immutable complete target sentence per complete source sentence. A later
  alignment request may return only cut positions into that target string; it
  must not rewrite the translation.
- The user approved a correctness-first alignment fallback: after bounded
  validation-guided alignment retries fail, emit one complete long cue spanning
  the full source sentence with its immutable full target translation. Never
  guess target cuts by character/time ratio.
- The user approved bounded local usage-ledger retention: keep exact per-video
  lifetime aggregates until explicit user clearing, retain the newest 20 detailed
  operations per video, and cap detailed operations globally at 2,000. Pruning
  detail records must never subtract from lifetime totals.
- At the provided Flash rates, excluding hidden reasoning, the current two-call
  whole-video flow is approximately CNY 0.021 on a cold input. A stable
  whole-video reference prefix with 8 display units per translation request is
  approximately CNY 0.031; a conservative 204 single-unit-request upper bound is
  approximately CNY 0.056.

## Requirements

### R1 — Complete-sentence translation ownership

- When Google JSON3 supplies usable word/symbol `tOffsetMs`, preserve those
  offsets, split after sentence punctuation, and expose an internal optional
  `sentenceEnd` hint. A sentence mark at the beginning of the next event closes
  the previous fragment. Untimed/manual captions retain the legacy parser and
  boundary-model path.
- A complete source sentence, determined from ordered ASR fragments, is the
  smallest unit whose target translation may be generated independently.
- Display-length refinement must not turn partial clauses into independent
  numbered translation items.
- The complete target sentence must remain attributable to exactly one complete
  source sentence; content must never cross into a neighbouring sentence.

### R2 — Short display cues without rewritten content

- Long translated sentences should still be divided into shorter display cues
  at existing source-fragment timing boundaries.
- Target display chunks must be ordered, non-empty, and together preserve the
  complete translated sentence without inventing, dropping, or duplicating text.
- Each emitted cue must use a contiguous source-fragment range for `s`, `d`, and
  `o`; target chunks must preserve the same monotonic order.
- Existing approximate targets remain the starting point: about 15 words for
  space-separated text and about 30 visible characters for CJK text.
- A single over-limit source fragment remains intact; intra-fragment timing is
  still owned by the later word-level task.
- Translate each complete source sentence without display markers to obtain the
  canonical target string. For sentences with multiple source display ranges,
  run a separate alignment request containing the complete source sentence,
  source display chunks, and immutable canonical target string.
- The alignment response returns target-string cut positions only. Validate the
  exact required cut count, integer/strictly increasing/in-range positions, and
  non-empty target slices. Slicing and cue construction are deterministic local
  operations.
- Reject cuts inside Latin/ASCII tokens, between adjacent Han characters, or
  immediately before closing punctuation. If no safe semantic cuts exist, use
  the approved complete-sentence fallback.
- Before calling alignment, count structurally safe positions locally. If fewer
  positions exist than the required cut count, fallback immediately instead of
  paying for retries that cannot produce a valid result.
- Concatenating every target display slice must reproduce the canonical target
  string exactly, character for character. Alignment retries may change cut
  positions but never the canonical translation.

### R3 — Verifiable failure behavior

- Structural validation must cover complete sentence ownership, display-range
  coverage, target-chunk count/order, and preservation of the complete target
  translation.
- A malformed or unalignable display split must not be cached as a normal
  successful short-cue result.
- Reject a boundary result that creates a likely false mega-sentence (over 30
  seconds, over 240 source code points, or over three terminal sentence marks).
- Validate canonical targets before caching: reject source echo/prefixes,
  kana-heavy Simplified-Chinese output, common Traditional-only characters, and
  severe long-source omissions. Retry with a compact correction tail; never
  cache the rejected target.
- Abort and navigation staleness must still prevent all L1/L2 writes.
- Existing fallback behavior may be revised when the current fallback can also
  produce semantic cross-line drift.
- An alignment response that remains invalid after bounded corrective retries
  falls back locally to one complete sentence cue. Record the fallback count in
  generation metadata; this safe fallback is a valid complete result and does
  not block other jobs or final persistence.
- Translation batching should be evaluated as the primary way to localize model
  failures: use complete source-sentence ownership, a stable cache-friendly
  whole-video context prefix, and a small requested sentence range in the prompt
  tail. Arbitrary cue-count batches must not cut through complete sentences.

### R4 — Timedtext video identity

- A captured timedtext response must be ignored unless its request video ID
  matches the current watch-page video ID.
- Existing duplicate-request suppression and same-video navigation behavior must
  remain intact.

### R5 — Repair and regression verification

- After the implementation is validated, `vvLnNHtY09U` must be regenerated or
  the known-bad shared artifact must be removed until regeneration is possible.
- Verification must explicitly inspect semantic anchors in
  `17.720–32.559s`, not only JSON/timing structure.
- The first repaired cue sequence must keep “Gundam Marker / many viewers” and
  “thank you / use the prior method” in the time ranges containing the matching
  Japanese source.

### R6 — Compatibility and quality

- Preserve title/description context and use it only as untrusted reference
  data.
- Preserve force retranslation's skip-read/full-success-overwrite behavior.
- Preserve the single static-import userscript IIFE and Trusted Types rules.
- Focused tests must exercise the real cross-line drift pattern in addition to
  existing count, timing, and coverage tests.
- Thinking mode must be explicitly selected per request role rather than relying
  on DeepSeek's provider default, so request count cannot silently multiply
  reasoning-token cost.
- Untimed boundary detection uses thinking mode and omits unsupported sampling
  controls. Timed-punctuation boundaries are local and record zero boundary
  requests. Translation batches use non-thinking mode; their temperature must
  be explicit and `top_p` must remain at its provider default unless later
  evidence justifies changing the alternative sampler instead.

### R7 — Progressive translation and display

- After whole-track sentence-boundary analysis, create a stable set of sentence
  translation jobs and translate them incrementally.
- On a fresh translation, prioritize the sentence covering the current playhead,
  then nearby upcoming speech, and reorder pending work when the user seeks.
  Already-running requests may finish; completed results must always assemble in
  source-time order rather than network-completion order.
- Each completed sentence must update the in-memory subtitle state immediately.
  Pending sentences display their original text; translation-only mode also
  falls back to original text rather than showing an empty overlay.
- Show bounded progress such as completed/total sentence jobs, without adding a
  persistent player control.
- Partial progressive results must never be written to L1 or L2. Persist exactly
  once after every sentence has a validated translation and the video is still
  current.
- Navigation abort discards the working queue and partial in-memory result without
  persistence.
- A permanently failed sentence may leave its original visible while other jobs
  finish, but the incomplete artifact must not be cached as successful.
- During explicit force retranslation, keep the previous complete artifact in
  Store; do not progressively mix old and new segmentation. Replace it atomically
  only after the new full artifact succeeds.

### R8 — Selectable request strategy

- Add a backward-compatible translation setting with three modes:
  `sentence`, `batch`, and `whole`. All modes operate on complete sentence units;
  none may restore display-capped partial clauses as translation items.
- `sentence` uses effective batch size 1 and is the default. `batch` uses a
  persisted integer batch size constrained to 2..32, defaulting to 8. `whole`
  uses the full sentence count.
- The settings panel must explain reliability/progress trade-offs and show the N
  input only for batch mode. Preserve the last batch-size value while another
  mode is selected.
- Strategy changes affect only future fresh/force translations. Existing cache
  hits remain valid; the panel must tell users to invoke explicit retranslation
  to regenerate the current video with the new strategy.
- Keep cache identity unchanged. Store optional backward-compatible artifact
  metadata describing mode, effective batch size, translation thinking state,
  and temperature so pool results remain diagnosable.
- Progressive display granularity follows the selected request: one sentence in
  sentence mode, one completed N-sentence batch in batch mode, and one final
  whole-video update in whole mode.

### R9 — Actual per-video API usage and cost

- Capture the provider `usage` object from every successful DeepSeek completion
  response, including responses whose content later fails format validation and
  is retried.
- Aggregate request count and usage across boundary detection, translation
  batches, alignment/correction requests, and their retries for one video
  translation operation.
- Track at least `prompt_tokens`, `prompt_cache_hit_tokens`,
  `prompt_cache_miss_tokens`, `completion_tokens`, `total_tokens`, and
  `completion_tokens_details.reasoning_tokens` when returned. Treat reasoning
  tokens as a subset of completion tokens; never double-charge them.
- For recognized official DeepSeek model/base-URL combinations, calculate CNY
  cost from an explicit pricing snapshot stored with the result. Current prices
  supplied for this task are, per million tokens: Flash hit 0.02, miss 1, output
  2; Pro hit 0.025, miss 3, output 6.
- For unknown providers/models or missing usage fields, retain raw usage and mark
  monetary cost unavailable rather than applying guessed prices.
- Store optional backward-compatible generation usage/cost metadata in a
  successful artifact so the future subtitle browser can display the measured
  cost and distinguish it from a tokenizer estimate.
- Maintain a local per-video operation ledger independent of the successful
  subtitle cache. Finalize one ledger record for every started translation
  operation with status `success`, `failed`, or `aborted`, stage/request counts,
  aggregate raw usage, pricing snapshot/cost when known, strategy metadata, and
  timestamps.
- The local ledger must include billable successful API responses from operations
  that never produce an artifact. Cache-only L1/L2 loads create no translation
  operation and add zero cost; reading an artifact's historical generation cost
  must never charge it again.
- Successful operation usage is written both to the artifact generation metadata
  and its local ledger record. Historical force retranslations append records
  instead of replacing prior spend.
- Preserve exact lifetime aggregates independently of detail retention. Keep the
  newest 20 operation details per video and at most 2,000 details globally;
  prune oldest detail records only. Usage history is not cleared as a side effect
  of clearing subtitle cache.
- Never log prompts, API keys, PATs, or reasoning content while recording usage.

## Acceptance Criteria

- [ ] Pass-2 translation receives complete source sentences, never display-capped
      partial clauses as independent numbered items.
- [ ] Word-timed `Ru7H092hFAI` parsing preserves the exact 5,618-character source,
      recovers deterministic sentence hints, produces no sentence over 30
      seconds, and performs zero boundary API requests.
- [ ] A long complete sentence can produce multiple ordered display cues without
      target content leaking into a neighbouring sentence.
- [ ] Concatenating a sentence's target display chunks reproduces its complete
      translation exactly after removing only intentional split delimiters.
- [ ] Target alignment is a separate request that returns cut positions only;
      the canonical complete translation is immutable and display slices
      concatenate back to it exactly.
- [ ] Canonical source-copy/Japanese-heavy/Traditional/incomplete responses are
      rejected and retried with a correction tail; unsafe word-internal target
      cuts are rejected before cue assembly.
- [ ] Every source fragment is covered exactly once, in order, by non-empty,
      non-overlapping display ranges derived from existing timing boundaries.
- [ ] Invalid target splitting follows the approved safe fallback and writes no
      semantically shifted artifact.
- [ ] Exhausted alignment retries produce one full-source/full-target long cue,
      never a proportional guessed split, and record the fallback in generation
      diagnostics.
- [ ] A target with too few structurally safe cut positions falls back locally
      with zero alignment API requests.
- [ ] A timedtext response whose `v` parameter differs from `getVideoId()` is
      ignored.
- [ ] Normal cache hits, explicit force retranslation, abort, navigation, and L2
      soft-failure behavior remain correct.
- [ ] On a fresh cache miss, a completed sentence becomes visible before the full
      video finishes translating; pending sentences remain watchable in the
      source language, including translation-only mode.
- [ ] Seeking reprioritizes pending sentence work around the new playhead without
      corrupting source-time ordering or duplicating requests.
- [ ] Progressive results remain memory-only; L1/L2 receive exactly one complete,
      validated artifact after all sentence jobs succeed.
- [ ] Force retranslation keeps the old complete subtitle visible and performs
      one atomic display switch after full success.
- [ ] Settings expose sentence/batch/whole strategies, default to sentence mode,
      retain batch size 8 by default, and merge older stored settings safely.
- [ ] Batch size is accepted only in 2..32; all three modes translate the same
      complete sentence jobs and differ only in request grouping.
- [ ] Changing strategy does not fork cache keys; force retranslation uses the
      new strategy and records optional diagnostic strategy metadata.
- [ ] Every successful DeepSeek response contributes exactly once to the
      operation aggregate, including parse-invalid responses that trigger retry;
      completion/reasoning tokens are not double-counted.
- [ ] A successful artifact records raw aggregate usage, request/stage counts,
      the pricing snapshot, and calculated CNY cost; unknown providers retain
      tokens without a fabricated monetary value.
- [ ] The local ledger records success/failure/abort operations and their returned
      usage exactly once, preserves earlier retranslations, and exposes a correct
      per-video lifetime sum without counting cache reads.
- [ ] Ledger pruning preserves exact lifetime totals while enforcing 20 recent
      details per video and 2,000 details globally; subtitle-cache clearing does
      not implicitly clear usage history.
- [ ] The repaired `vvLnNHtY09U` result passes the semantic anchor check around
      17.7–32.6 seconds.
- [ ] Stored artifacts remain readable with `{s,d,o,t}` cues and the existing
      cache key/path.
- [ ] `pnpm compile`, `pnpm test`, and `pnpm build` pass; the userscript remains a
      single IIFE without SystemJS/dynamic imports.

## Out of Scope

- Terminology extraction or glossary management.
- Statistical word-level segmentation for untimed tracks, MAD/Z-score boundary
  inference, or synthesizing timestamps Google did not provide.
- Supporting additional video sites or live captions.
- A general semantic-quality scorer for arbitrary language pairs.
- The stored-subtitle browser UI. Keep it as the next independent task; it should
  cover a current-video transcript side panel and a local L1 cache library first,
  with GitHub-pool-wide indexing considered later. This task only preserves the
  title, generation strategy, and measured usage metadata that browser will need.

## Resolved Product Decisions

- Alignment fallback: **resolved** — use one complete long sentence cue after
  bounded retries; never perform approximate proportional target splitting.
- Initial internal concurrency is 8 after one sequential cache-warm request. It
  is not user-facing in this task and may be reduced by implementation evidence
  from browser pressure/rate-limit tests.
- Target-display alignment pass: **resolved** — always separate canonical
  translation from cut-position-only alignment when a sentence needs multiple
  display ranges.
- Local-ledger retention: **resolved** — exact lifetime totals, newest 20 details
  per video, and 2,000 details globally, with explicit-only history clearing.

## Follow-up Task Note

Create a separate stored-subtitle browser task after this translation pipeline
task. Recommended first scope: current-video transcript side panel (search,
click-to-seek, current-cue highlight, progressive updates) plus local IndexedDB
cache listing. Add GitHub-pool-wide browsing only after choosing a remote index
strategy; the current sharded pool has no manifest and anonymous GitHub tree
enumeration is rate-limited.
