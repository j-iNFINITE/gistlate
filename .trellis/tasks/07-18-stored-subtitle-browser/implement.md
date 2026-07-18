# Implementation Plan — Stored subtitle browser

## Preconditions

- [x] User previously approved the stored-subtitle-browser follow-up and now
  explicitly asked to continue and complete it.
- [x] Scope stays local-L1/current-video; GitHub pool-wide indexing remains out.
- [x] Run `trellis-before-dev` and load current frontend/data-flow specs before
  editing source.

## Phase A — Data and export contracts

- [x] Add a newest-first, expiration-aware `listL1()` API without changing the
  IndexedDB version or cache eviction behavior.
- [x] Propagate the accepted/new `CacheEntry` through resolve results into the
  optional Store subtitle artifact; notify Store listeners on reset.
- [x] Add pure transcript search/index projection and SRT formatting/export
  contracts with explicit incomplete-target rejection.
- [x] Add focused fake-indexeddb, Store/resolve, search and SRT regression tests.

## Phase B — Browser UI

- [x] Build a Trusted Types-safe singleton side panel with current/library tabs,
  responsive layout, close action and accessible labels.
- [x] Render current Store cues progressively; preserve search order, highlight
  active playback cue and scroll only on active-row changes.
- [x] Render optional title, language, strategy, usage/token and actual CNY cost
  metadata with legacy fallbacks.
- [x] List/open local L1 artifacts; allow seeking only for the current video.
- [x] Wire source/translated SRT downloads and visible error/empty states.

## Phase C — Integration and lifecycle

- [x] Extend the re-injectable player controls with a transcript entry while
  preserving existing GL/Aa behavior and fallback controls.
- [x] Register the same browser through the userscript menu.
- [x] Pass current video title/seek callbacks from `main.ts`; keep navigation,
  activation, translation and retranslation ownership in `main.ts`.
- [x] Verify panel close/unsubscribe and SPA/current Store-reset behavior.

## Tests and Verification

- [x] Run focused tests while implementing.
- [x] Run `trellis-check`, full `pnpm test`, `pnpm compile`, and `pnpm build`.
- [x] Inspect production output for one IIFE, no SystemJS/dynamic `import()` and
  no `innerHTML`/`outerHTML`/`insertAdjacentHTML` sinks.
- [ ] Test in installed Chrome userscript: current transcript, search, click seek,
  active highlight, library open, old metadata fallback, source SRT, translated
  SRT, incomplete translated export and SPA navigation.

## Rollback Points

- Data helpers are additive and require no DB migration.
- Store/resolve artifact metadata is optional; reverting the panel can retain or
  remove it without changing persisted artifacts.
- Player/menu entry wiring is separable from translation/acquisition paths.

## Deferred Follow-ups

- GitHub pool-wide manifest/index and rate-limit strategy.
- Cache deletion/bulk management and usage-history UI.
- Mobile-specific layout beyond the responsive fixed panel.
