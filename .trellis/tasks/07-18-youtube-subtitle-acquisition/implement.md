# Implementation Plan — subtitle acquisition and track identity

## Step 1 — Contracts and pure selection

- [x] Add player-response, caption-track, audio metadata, identity, purpose and acquisition-state types.
- [x] Implement normalization and deterministic `selectCanonicalTrack` with the approved priority.
- [x] Add table-driven unit tests, including target language aliases and multiple manual tracks.

## Step 2 — Network observation

- [x] Extend `intercept/netHook.ts` to observe/copy timedtext URLs and stage raw payloads without mutating requests or responses.
- [x] Key candidates by video/language/kind/vssId; retain bounded per-video state and POT waiters.
- [x] Preserve existing fetch/XHR cleanup and dedup guarantees; add tests for URL parsing, POT caching and auto-translation exclusion.

## Step 3 — Player adapter and active fetch

- [x] Add feature-detected Watch-player access with strict expected-video validation.
- [x] Normalize caption tracks, active audio metadata, selected track, device/cver and audio-caption POT URLs.
- [x] Add JSON3 URL builder and `gmFetch` response validation.
- [x] Implement the bounded player-state/CC/audio-POT/observed-timedtext fallback and retry policy.
- [x] Unit-test pure builders/extractors; integration-test abort and failure categories.

## Step 4 — Acquisition session

- [x] Introduce one AbortController-backed session per video.
- [x] Select before any translation/cache read, race matching staged interception with direct fetch and publish once.
- [x] Add interception-only fallback for temporarily unavailable player APIs.
- [x] Ignore later non-canonical tracks and all late prior-video results.
- [x] Integrate acquisition start/stop/stage state with `main.ts` through the Store AbortSignal and `onStage`, without introducing duplicate session state.

## Step 5 — Processing branches

- [x] Pass explicit manual/ASR kind to timedtext parsing and translation planning.
- [x] Add manual one-cue-per-owner planning and truthful `manual-cues` diagnostics with zero boundary requests.
- [x] Preserve all current ASR timed and LLM-boundary behavior/tests.
- [x] Add direct-target publication that bypasses resolve/cache/usage completely.

## Step 6 — Cache compatibility

- [x] Add source normalization and versioned SHA-256 fingerprint helper.
- [x] Add optional track/fingerprint metadata to `CacheEntry` and generation writes.
- [x] Validate current and legacy L1/L2 entries against canonical source before accepting them.
- [x] Test compatible legacy hits, mismatched misses and full-success-only overwrite behavior.

## Verification

- [x] Run acquisition and existing semantic/usage/cache tests.
- [x] Run full `pnpm test`, `pnpm compile`, `pnpm build`.
- [x] Replay `Ru7H092hFAI` and confirm the ASR owner/display counts remain semantically equivalent with zero boundary requests for word-timed ASR.
- [ ] Test at least one manual-caption video: one owner per manual cue, no boundary call.
- [ ] Test a target-language manual track: direct display and zero DeepSeek usage.
- [ ] Exercise an available POT path and record bounded failure behavior if YouTube does not require POT during the check.
