# Implementation Plan — YouTube subtitle platform enhancements

## Preconditions

- [x] User approves `prd.md`, `design.md` and this plan.
- [x] Start the parent task with `task.py start`; do not archive the still-open semantic-alignment task until its online retranslation check is complete.
- [x] Run `trellis-before-dev` and load the relevant frontend/shared specs before editing source.

## Phase A — Canonical subtitle acquisition

- [x] Add typed YouTube player/track contracts and pure canonical-track selection.
- [x] Extend the timedtext observer to stage request URLs/POT and raw JSON3 payloads by track identity without changing YouTube responses.
- [x] Add direct JSON3 URL construction, player-data access and bounded POT fallback using the existing `gmFetch`/AbortSignal path.
- [x] Add a per-video acquisition session that races canonical intercepted data with active fetch, deduplicates delivery and rejects stale video IDs.
- [x] Route target-language manual captions to direct display, manual source captions to one-cue-per-owner translation, and ASR to the existing timed reconstruction path.
- [x] Add source fingerprint metadata and validate all L1/L2 hits against the current canonical source while keeping pool paths unchanged.
- [ ] Verify acquisition child acceptance criteria and keep the current overlay usable before starting Phase B. (Automated criteria pass; installed-userscript Watch checks remain.)

## Phase B — Rendering, settings and activation

- [x] Introduce backward-compatible nested original/translation text styles, translation order, anchored position and `autoStart=true` default.
- [x] Refactor the overlay into a pointer-transparent player-sized root, one styled text container and a small interactive drag handle.
- [x] Add three display modes, target-direct rendering, duplicate-line suppression and correct source/target `lang`/`dir`.
- [x] Implement vertical drag, top/bottom anchor switching, dynamic control-bar clearance, resize clamping and fullscreen-safe mounting.
- [x] Upgrade player controls to expose current-video activation and the consolidated subtitle settings panel while preserving the userscript menu for API/GitHub settings.
- [x] Connect auto-start/current-video stop to acquisition cancellation, overlay cleanup, usage finalization and native-caption restoration.
- [x] Add acquisition/loading/error states without permanently obstructing playback.

## Tests and Verification

- [x] Add/adjust unit and integration tests listed in both child plans.
- [x] Run `pnpm test` and confirm all existing semantic alignment, usage ledger, cache and retranslation tests remain green.
- [x] Run `pnpm compile`.
- [x] Run `pnpm build`; inspect the output for one IIFE, no `System.register`, no dynamic `import(` and no unsafe `innerHTML` additions.
- [ ] Manually test normal Watch pages: artificial/manual source, Google word-timed ASR, target-language artificial direct display, control-bar show/hide, drag/reload, auto-start off/manual start, deactivate/reactivate, seek, SPA navigation and fullscreen.
- [x] Run `trellis-check` before commit.

## Rollback Points

- Acquisition modules are separable from the response hook; if active fetch is unreliable, disable session active-fetch initiation while retaining intercepted delivery.
- Cache path and DB schema remain unchanged; optional metadata can be omitted without invalidating existing artifacts.
- Rendering migration accepts the legacy settings shape, so the overlay can be reverted without clearing user settings or subtitle data.

## Deferred Follow-ups

- SRT export: `07-18-stored-subtitle-browser`.
- Embed and Shorts: not scheduled in this parent task.
