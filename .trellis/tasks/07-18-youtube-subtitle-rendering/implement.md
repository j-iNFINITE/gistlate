# Implementation Plan — subtitle rendering and settings

## Step 1 — Settings contracts and migration

- [x] Add nested original/translation text style, translation order, anchored position, third display mode and `autoStart=true`.
- [x] Migrate the legacy flat style shape without changing its default appearance.
- [x] Clamp/validate persisted values and add migration tests for old, partial and malformed settings.

## Step 2 — Overlay view and style

- [x] Extract a pure view-model resolver for modes, pending translations, target-direct cues and duplicate suppression.
- [x] Refactor overlay DOM into player root, anchored stack, shared background box, two independently styled lines and grip.
- [x] Apply independent CSS variables and correct line order.
- [x] Add language/direction helper and set per-line `lang`/`dir`.

## Step 3 — Positioning

- [x] Implement pointer-only vertical drag on the grip, top/bottom anchor conversion and persisted percent.
- [x] Replace fixed-only control clearance with measured height plus fallback.
- [x] Add ResizeObserver/fullscreen clamping and cleanup all listeners/observers on navigation/destroy.
- [ ] Test pure position calculations and manually verify the video remains clickable. (Pure calculations are covered; installed-player click behavior remains manual.)

## Step 4 — Player controls and panel

- [x] Add idempotent current-video activation button alongside the settings button.
- [x] Consolidate display/style/auto-start controls in a fullscreen-safe player-mounted panel.
- [x] Preserve live preview, Save, Reset and Close/revert; keep model/API/GitHub controls in the existing general dialog.
- [x] Keep a floating fallback only when YouTube's right-controls bar is unavailable.

## Step 5 — Activation and native-caption lifecycle

- [x] Wire auto-start/navigation and player toggle to the acquisition session.
- [x] Suppress immediate restart after manually disabling the current video.
- [x] Abort safely on disable/navigation; clear overlay/status and restore native captions.
- [x] Scope native-caption hiding to active Gistlate state and restore it on no-source terminal errors.

## Step 6 — Status integration

- [x] Map acquisition states to waiting/fetching/POT/direct-ready/error UI.
- [x] Preserve current boundary/translation/alignment progress and non-obstructive auto-hide behavior.

## Verification

- [x] Run rendering/settings tests plus the full suite.
- [x] Run `pnpm compile` and `pnpm build`; verify one IIFE and Trusted Types-safe DOM creation.
- [ ] Manual Watch tests: display modes, ordering, independent typography, preview/revert/save/reset, drag/reload, controls show/hide, resize, seek, fullscreen, auto-start off/manual start, deactivate/reactivate and SPA navigation.
- [ ] Confirm inactive and acquisition-error states restore native YouTube captions.
