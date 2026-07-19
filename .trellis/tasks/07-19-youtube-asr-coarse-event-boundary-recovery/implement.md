# Implementation plan — YouTube ASR boundary recovery

## 1. Red tests

- [x] Add a JSON3 word-timed fixture whose first event ends normally and whose
      next visible event begins about 38 seconds later.
- [x] Assert the current parser incorrectly stretches the first cue, then lock
      the desired bounded duration and preserved gap.
- [x] Carry that output through complete-range planning and assert the safety
      limit no longer rejects it.
- [x] Add an explicitly ASR coarse-event fixture with multiple internal English
      sentences and assert punctuation splits, full boolean flags, text
      preservation, and proportional timing.
- [x] Add manual/unknown-track compatibility assertions.

## 2. Parser implementation

- [x] Add a natural exclusive end to internal word-timed fragments.
- [x] Bound last-token timing by the event's natural end and next visible start.
- [x] Preserve real gaps while enforcing positive, monotonic, non-overlapping
      emitted cues.
- [x] Add the coarse-ASR punctuation adapter, sharing existing sentence-mark and
      duration rules rather than duplicating constants.
- [x] Keep manual and unknown sparse-track legacy behavior unchanged.

## 3. Runtime observability

- [x] Import `GM_info` from `$` in the userscript entry.
- [x] Include only `GM_info.script.version` in the startup log while preserving
      the `[Gistlate]` prefix.

## 4. Focused validation

- [x] Run timedtext and sentence-planning tests.
- [x] Re-run the new long-silence and coarse-event regressions independently.
- [x] Run existing high-density English, Japanese word-timing, decimal/version,
      packed-event, and manual-caption tests.

## 5. Full quality gate

- [x] Run all tests.
- [x] Run `pnpm compile`.
- [x] Run `pnpm build`.
- [x] Inspect `dist/gistlate.user.js` for the version log, one IIFE, no SystemJS,
      no dynamic-import loader, and no prohibited Trusted Types sinks.
- [x] Run the Trellis quality check and address findings.

## 6. Project memory and delivery

- [x] Update the frontend executable subtitle contract with the natural-end,
      gap-preservation, and explicit coarse-ASR punctuation rules.
- [x] Record the debug retrospective: a gap-free adapter converted silence into
      speech duration, while a cue-level boundary protocol could not express
      internal coarse-event punctuation.
- [x] Commit code/tests, then spec/task updates in reviewable commits.
- [ ] Push `master`, wait for the release workflow, and verify the new release
      metadata and userscript asset before reporting completion.
