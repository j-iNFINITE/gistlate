# Implementation plan: semantic-aligned progressive subtitle translation

## Preconditions

- User reviews and approves `prd.md`, `design.md`, and this plan.
- Activate the task with `task.py start` only after review.
- Before editing source, load `trellis-before-dev` and the relevant frontend
  specs/guides.
- Work inline in the main session; no sub-agent manifests are required.

## Execution status (2026-07-18)

- [x] Steps 1–6 implemented with focused unit/integration coverage.
- [x] Automated Step 7 gate passes: 143 tests, TypeScript compile, production
      build, single-IIFE/SystemJS/dynamic-import audit, and diff check.
- [x] Recorded `vvLnNHtY09U` 17.720–32.559s semantic anchors as a regression
      fixture using the source meanings preserved in the current pool artifact.
- [x] Step 8 code-spec updates and `trellis-check` review completed.
- [ ] Manual Tampermonkey + live DeepSeek run remains required because YouTube
      currently exposes no downloadable original ASR track for this video.
- [ ] Do not overwrite/remove the bad remote pool artifact until that live result
      passes semantic review; no remote mutation was performed in this session.
- [x] Follow-up `Ru7H092hFAI` audit downloaded `ja-orig` JSON3 and reproduced the
      actual parser loss of internal word-timed sentence boundaries.
- [x] Added minimal `tOffsetMs` sentence recovery, local timed-punctuation
      boundaries, mega-sentence limits, canonical quality retry, and word-safe
      alignment cuts. Real replay preserves all 5,618 source characters, yields
      169 sentence plans, and has a 13.742s maximum sentence (zero over 30s).
- [x] Follow-up automated gate passes: 20 test files / 159 tests, TypeScript
      compile, production build, one IIFE, and zero SystemJS/dynamic imports.

## Step 1 — Settings and backward-compatible metadata contracts

- [ ] Extend `src/settings.ts` with `TranslationMode` and
      `TranslationSettings {mode,batchSize}`.
- [ ] Default to sentence mode and remembered batch size 8.
- [ ] Validate/merge old settings; accept only sentence/batch/whole and clamp
      integer batch size to 2..32.
- [ ] Add settings-panel strategy select, conditional N input, descriptions, and
      “affects fresh/force translation” cache hint.
- [ ] Preserve style-panel/settings-panel non-clobber behavior.
- [ ] Extend `CacheEntry` with optional video/generation metadata types while
      retaining the existing key/path and cue schema.
- [ ] Add focused settings tests (create a settings test module if none exists).

Validation:

```powershell
pnpm vitest run src/settings.test.ts
pnpm compile
```

Rollback point: strategy settings and optional metadata compile independently of
the new pipeline.

## Step 2 — Provider usage, pricing, and persistent ledger

- [ ] Add `src/usage/contracts.ts` as the only decoder/normalizer for provider
      usage payloads and aggregate math.
- [ ] Add `src/usage/pricing.ts` with exact official DeepSeek Flash/Pro price
      snapshots and strict hostname/model detection.
- [ ] Add `src/usage/ledger.ts` using a separate `gistlate-usage` IndexedDB:
      lifetime totals + recent operation details.
- [ ] Implement begin, append-response-usage, finalize, stale-running reconcile,
      list/read projections needed by the future browser, and explicit clear.
- [ ] Enforce newest 20 details per video and 2,000 globally without changing
      lifetime totals.
- [ ] Keep subtitle `clearL1()` independent of usage history.
- [ ] Add tests for decoding, reasoning subset/no double charge, pricing,
      concurrent accumulation, terminal status, pruning, and stale reconciliation.

Validation:

```powershell
pnpm vitest run src/usage
pnpm compile
```

Rollback point: usage modules can exist without transport integration.

## Step 3 — OpenAI/DeepSeek request profiles and usage propagation

- [ ] Extend `Completion`/transport returns with normalized optional usage.
- [ ] Centralize request role/options: boundary, translation, alignment.
- [ ] For official DeepSeek boundary calls send thinking enabled/high and no
      temperature/top-p.
- [ ] For official DeepSeek translation/alignment send thinking disabled,
      temperature 0, default top-p; alignment may request JSON output.
- [ ] Preserve compatible generic Chat Completions and OpenAI Responses behavior;
      do not send DeepSeek-only fields to unknown providers.
- [ ] Surface each HTTP-success usage payload to the operation collector before
      parsing/validation can trigger retries.
- [ ] Ensure test-connection requests use a compatible non-thinking profile and
      do not enter a video ledger.
- [ ] Add transport/request-body/usage tests for Flash, Pro, unknown proxy,
      Chat/Responses selection, and parse-invalid retry counting.

Validation:

```powershell
pnpm vitest run src/translate/openai.test.ts src/usage
pnpm compile
```

Rollback point: the existing pipeline still works through updated transport
signatures.

## Step 4 — Complete sentence plans, global IDs, and target alignment

- [ ] Refactor `src/translate/segment.ts` so complete ranges remain translation
      owners and display capping produces nested ranges instead of a flattened
      translation list.
- [ ] Add `src/translate/jobs.ts` (or equivalent) with SentencePlan/Job building,
      coverage validation, working/final cue assembly, and safe long-cue fallback.
- [ ] Add stable-reference translation prompt with global sentence IDs.
- [ ] Add exact requested-ID parser (missing/duplicate/extra/empty rejected).
- [ ] Add cut-position-only alignment prompt/JSON parser using Unicode code-point
      indexing and exact target reconstruction.
- [ ] Add validation-guided alignment retry tail and safe full-sentence fallback
      after three total attempts.
- [ ] Add tests for plan coverage, English/CJK caps, global IDs, cut validation,
      Unicode offsets, reconstruction, and fallback timing/diagnostics.

Validation:

```powershell
pnpm vitest run src/translate/segment.test.ts src/translate/jobs.test.ts src/translate/prompt.test.ts
pnpm compile
```

Rollback point: pure planning/alignment layer is testable before network
scheduling changes.

### Step 4 follow-up — real Google ASR correctness

- [x] Recover internal punctuation fragments from usable Google `tOffsetMs` and
      retain legacy parsing for untimed/manual tracks.
- [x] Skip the boundary API when every source Cue has a deterministic
      `sentenceEnd`; record boundary method/request count in generation metadata.
- [x] Reject 30s/240-code-point/3-stop false sentence plans.
- [x] Validate canonical target language, source echo/prefix, and completeness;
      retry with a cache-friendly correction tail.
- [x] Reject Latin-token, Han/Han, and pre-punctuation alignment cuts.
- [x] Preflight the count of safe cut positions and immediately fallback with
      zero alignment calls when a valid response is structurally impossible.
- [x] Replay `Ru7H092hFAI.ja-orig.json3`: exact 5,618-character source, 439
      fragments, 169 plans, 13.742s maximum plan, no >30s plan.

## Step 5 — Strategy grouping, cache warm-up, scheduling, and progressive pipeline

- [ ] Replace the current flattened `translateAllCues` flow with complete
      sentence jobs.
- [ ] Implement pure sentence/batch/whole grouping; batch N 2..32, whole all.
- [ ] Retain adaptive contiguous split only for truncation/count failures without
      changing sentence ownership.
- [ ] Implement a bounded scheduler (initial concurrency 8): current-playhead
      warm-up request first, then priority dequeue for current/upcoming work.
- [ ] Support pending-work reprioritization on seek while allowing in-flight work
      to finish once.
- [ ] Translate canonical sentences, align long sentences separately, and emit
      ordered progress snapshots only after validated sentence completion.
- [ ] Continue independent jobs after a single failure for fresh viewing, but
      reject final persistence if any translation job remains failed.
- [ ] Remove the old fragment 1:1 semantic-drift fallback; boundary failure or an
      irreducible single-sentence translation failure is fail-closed.
- [ ] Aggregate generation diagnostics: actual request counts, alignment requests,
      retries, fallback sentence count, first-result/full latency if retained.
- [ ] Rewrite/add pipeline tests for all modes, warm-up order, out-of-order
      completion, seek priority, progress granularity, adaptive split, failure,
      abort, and the recorded `vvLnNHtY09U` semantic-anchor fixture.

Validation:

```powershell
pnpm vitest run src/translate/pipeline.test.ts src/translate/jobs.test.ts
pnpm compile
```

Rollback point: new pipeline returns the same final `Cue[]` contract before UI
progress is wired.

## Step 6 — Resolve, Store, overlay, status, and timedtext identity

- [ ] Extend `ResolveOptions` with progress/current-playhead callbacks and thread
      strategy/context/usage collector through the pipeline.
- [ ] Begin a ledger operation only on a genuine translation (not L1/L2 hit).
- [ ] Finalize usage ledger success/failed/aborted in one terminal path.
- [ ] Embed successful operation usage/cost, strategy, video title, and alignment
      diagnostics into optional CacheEntry generation metadata.
- [ ] Keep one complete-only L1 write and one L2 attempt; re-check abort before
      persistence.
- [ ] Make Store subtitle updates notify current-time subscribers.
- [ ] On fresh translation, install progress working cues; on force translation,
      update status only and retain old Store cues until full success.
- [ ] Make pending translations show source text in translation-only mode.
- [ ] Extend status pill with boundary/translation/alignment completed/total
      progress while retaining terminal auto-hide and navigation cleanup.
- [ ] Reprioritize scheduler from playhead/seek signals without creating duplicate
      operations.
- [ ] Require timedtext request `v` to equal current watch `videoId` before track
      dedupe/state mutation.
- [ ] Add resolve/store/main-adjacent tests for cache hits (zero operation), fresh
      progress, force atomic switch, abort, ledger terminal state, no partial
      write, L2 soft failure, and stale timedtext rejection.

Validation:

```powershell
pnpm vitest run src/core src/subtitles src/ui src/youtube.test.ts
pnpm compile
```

Rollback point: final UI/persistence integration; known-bad remote artifact is not
changed yet.

## Step 7 — Full quality gate and real-video experiment

- [ ] Run complete unit/integration suite and compile.
- [ ] Build the userscript and inspect the output shape/grants.
- [ ] Verify no dynamic import/SystemJS and one IIFE body.
- [ ] Install/test on `vvLnNHtY09U` with official DeepSeek Flash.
- [ ] Sentence mode: confirm boundary thinking, translation/alignment non-thinking
      temperature 0, cache warm-up, progressive current-sentence display, seek
      priority, and final persistence.
- [ ] Inspect 17.720–32.559 seconds for exact semantic anchors; original and target
      must refer to the same speech range.
- [ ] Compare provider `usage` fields with recorded stage/total aggregates and CNY
      formula; verify reasoning is a completion subset.
- [ ] Verify artifact generation metadata and local lifetime/recent ledger.
- [ ] Force test batch N=8 and whole modes; compare first-result/full latency,
      cache hit rate, actual cost, failures, and fallback count.
- [ ] Test one forced alignment failure and confirm long-cue fallback.
- [ ] Test navigation during progressive translation: partial Store result clears,
      ledger aborts, L1/L2 remain unchanged.
- [ ] After the sentence-mode result passes semantic review, use force
      retranslation to overwrite the bad `pool` artifact. If the source track is
      unavailable, leave/remove the known-bad artifact only with explicit user
      direction; never claim it was repaired.

Quality commands:

```powershell
pnpm compile
pnpm test
pnpm build
rg -n "System\.register|systemjs|@require.*system" dist/gistlate.user.js
git status --short
git diff --check
```

## Step 8 — Spec and finish

- [ ] Update `.trellis/spec/frontend/quality-guidelines.md` to replace the false
      “same range guarantees semantic alignment” claim with complete-sentence
      ownership + cut-position alignment contracts.
- [ ] Update state-management/directory specs for observable progressive Store,
      sentence jobs, and separate usage DB.
- [ ] Record the stored-subtitle browser as the next independent task, not this
      implementation.
- [ ] Run `trellis-check`, review diff, commit source/tests/spec/task artifacts,
      and finish/archive per workflow.

## Risk and rollback notes

- Highest risk: scheduler/progress/abort races. Keep operation IDs and one owner
  for state transitions; test out-of-order completions and navigation heavily.
- Next risk: provider-specific request fields. Gate DeepSeek-only payload fields
  by strict official host/model detection.
- Next risk: usage double counting under retry/concurrency. Decode once at the
  HTTP boundary and aggregate with one operation collector.
- Next risk: Unicode cut indexing. Define code-point indexing in prompt and use
  one shared slicer.
- Do not mutate/delete the remote bad artifact until a real replacement is
  semantically verified.
