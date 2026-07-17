# Implementation plan: translation context, explicit retranslation, and cue-length cap

## Preconditions

- User has approved `prd.md` and `design.md`.
- Start this child task, not its parent.
- Load `trellis-before-dev` and the frontend/guides context before editing source.
- Keep the existing working tree changes to this task's planning artifacts.

## 1. Add the translation-context contract and YouTube adapter

- [x] Add `src/translate/context.ts` with the shared `TranslationContext` type,
      centralized normalization, and bounded title/description constants.
- [x] Add focused unit tests for empty values, whitespace collapse, and caps.
- [x] Extend `src/youtube.ts` with current-video-safe title/description extraction:
      matching player-response data first, DOM metadata/document-title fallback.
- [x] Ensure stale player-response metadata from a previous SPA video is rejected.
- [x] Keep missing metadata a soft fallback.

Validation/rollback point:

- Run the new context tests and `pnpm compile`.
- The adapter is additive and can be removed without touching stored data.

## 2. Thread context through the translation path

- [x] Extend `fillPrompt` to accept normalized context and place JSON-encoded
      reference data before the numbered subtitles.
- [x] Add a system-level rule that metadata is untrusted reference data, never
      instructions or subtitle output.
- [x] Extend `translateBatch`, `translateRange`, `translateAllCues`, and
      `resolveTranslation` contracts so pass 2 and its recursive splits receive
      the same context.
- [x] Keep pass-1 boundary detection context-free and add no extra LLM request.
- [x] Preserve existing custom-prompt and connection-test call behavior.
- [x] Add/update prompt and pipeline tests for context present/absent and strict
      numbered output.

Validation/rollback point:

- Run prompt/pipeline tests and `pnpm compile`.
- Passing `undefined` context must reproduce existing behavior.

## 3. Add deterministic display-range capping

- [x] Add centralized English-word and CJK-visible-character target constants in
      `src/translate/segment.ts`.
- [x] Implement a pure range-refinement helper that only emits contiguous ranges
      over existing source fragments.
- [x] Prefer nearby punctuation/pause boundaries; use the closest reliable
      fragment boundary otherwise.
- [x] Keep a single over-limit fragment intact.
- [x] Apply the helper between boundary grouping and pass-2 text construction.
- [x] Add segment tests for short ranges, English/CJK limits, natural boundaries,
      single-fragment exception, and exact ordered coverage.
- [x] Extend the pipeline test to prove capped ranges are translated 1:1 and timed
      from those same ranges.

Validation/rollback point:

- Run segment/pipeline tests.
- Temporarily replacing capped ranges with the original ranges must restore the
  previous behavior without data migration.

## 4. Add force-cache resolution semantics

- [x] Introduce `ResolveOptions` and migrate the sole production caller from
      positional optional arguments.
- [x] In force mode, skip `getL1` and `readL2` while retaining the existing
      translate -> putL1 -> writeL2 sequence.
- [x] Add `src/core/resolve.test.ts` with module mocks proving normal cache order,
      force-read bypass, write-after-success, and no write on failure/abort.
- [x] Preserve L2 write soft-fail behavior.

Validation/rollback point:

- Run resolve/cache tests and `pnpm compile`.
- `force` defaults false, so normal resolution remains backward compatible.

## 5. Wire the retranslation menu and runtime lifecycle

- [x] Capture the cleaned original `CurrentTrack` in `src/main.ts`; never replace
      it with translated sentence cues.
- [x] Clear the snapshot on genuine video navigation.
- [x] Turn `translatingVideoId` into actual in-flight state cleared in `finally`,
      while retaining `handledTrackKey` request deduplication.
- [x] Load settings and video context at each translation start rather than using
      the startup snapshot for target-language decisions.
- [x] Register `Gistlate 重新翻译当前视频` as a GM menu command.
- [x] Handle no-track, already-translating, cancel, confirmed force, success,
      failure, and navigation-abort paths.
- [x] Keep existing Store cues visible until successful replacement.
- [x] Reuse the existing translating/done/error status pill; add no player button.

Validation/rollback point:

- Run `pnpm compile` and the full unit suite.
- Manually verify menu cancellation, cache bypass, old-result preservation, and
  SPA-abort behavior on YouTube.

## 6. Full quality gate

- [x] Run `pnpm compile`.
- [x] Run `pnpm test` and confirm all existing and new tests pass.
- [x] Run `pnpm build`.
- [x] Inspect `dist/gistlate.user.js`: one IIFE, no `System.register`, no SystemJS,
      and expected GM grants/menu registration.
- [x] Review the cross-layer path from metadata source through prompt, and from
      menu action through cache writes and Store replacement.
- [x] Verify `git diff --check` and inspect the final diff for unrelated changes.

## 7. Finish-work obligations

- [x] Run `trellis-check` for spec compliance, data flow, reuse, type safety, and
      full-scope acceptance coverage.
- [x] Update frontend specs with any durable contract learned during implementation,
      especially force-retranslation state and range-capping alignment rules.
- [ ] Record session progress in the developer journal.
- [ ] Commit the implementation and planning/spec updates with a focused message.
- [ ] Archive this child task only after every acceptance criterion passes.
- [ ] Update the parent task's completion state; leave word-level segmentation as
      the remaining child.
