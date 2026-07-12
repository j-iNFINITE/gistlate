# Implementation Plan — subtitle display polish

> Validation after each step: `pnpm compile`, `pnpm test`, `pnpm build` (single
> IIFE). Follow `design.md`. No schema change; extend `Settings.style`.

## Step 1 — Linger fix (cue-duration cap)
- [ ] `translate/segment.ts` `sentencesToCues`: cap end at
      `min(nextStart, rawEnd + GAP_TOLERANCE)` (1200ms) for non-last; `rawEnd` for
      last; `d = max(1, end - s)`.
- [ ] `translate/segment.test.ts`: cases — small gap bridges to next start; long gap
      → `rawEnd + tol`; overlap → `nextStart`; last → `rawEnd`; still non-overlapping.
- **DoD:** long music gap no longer lingers (verified by test + manual). Fastest win.

## Step 2 — Control-bar-aware positioning
- [ ] `ui/overlay.ts`: overlay `bottom` = `calc(var(--gl-bottom) + var(--gl-ctrl-offset,0px))`.
- [ ] Add a `MutationObserver` on `#movie_player` class → set `--gl-ctrl-offset`
      (`~56px` when controls shown / `0` when `ytp-autohide`); init on mount;
      disconnect on destroy.
- **DoD:** subtitle raises when controls show, returns when they hide.

## Step 3 — Draggable subtitle + persist
- [ ] `settings.ts`: add `SubtitleStyle.hOffset` (px, default 0); `mergeStyle` default.
- [ ] `ui/overlay.ts`: make the inner text wrapper `pointer-events:auto; cursor:move`
      (container stays `pointer-events:none`); container
      `transform: translateX(var(--gl-hoffset,0px))`; `applyStyle` sets `--gl-hoffset`.
- [ ] Drag handler (pointerdown/move/up + setPointerCapture): live-update
      `--gl-bottom` (%) + `--gl-hoffset` (px), clamp on-screen, ignore sub-threshold
      clicks, persist on pointerup via `saveSettings`.
- **DoD:** drag repositions, persists across reload, video still clickable.

## Step 4 — Seek sync
- [ ] `main.ts`: `seeked` handler resets `lastCueKey=''` then `setCurrentTime` for an
      immediate refresh.
- **DoD:** seeking shows the correct line immediately.

## Final gate (2.2)
- [ ] Run all AC on a real video (long-gap linger, control-bar raise, drag+persist,
      seek). `pnpm compile && pnpm test && pnpm build` green, single IIFE.
- [ ] Dispatch `trellis-check`.

## Notes
- Style-panel entry / fullscreen panel limitation unchanged (out of scope).
- The word-level-segmentation child will later rework timing; keep the linger cap
  principle when it does.
