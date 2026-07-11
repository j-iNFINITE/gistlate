# Implementation Plan — style panel + one-shot translation

> Two independent milestones. Validation baseline after each: `pnpm compile`,
> `pnpm test`, `pnpm build` all green. Follow `design.md` for contracts.
> No new deps; keep single-file IIFE (no dynamic imports).

## M1 — Live subtitle style panel

- [ ] **settings.ts**: add `SubtitleStyle` interface + `Settings.style`; add
      `DEFAULTS.style` matching the current MVP look; extend `mergeDefaults` with a
      backward-compatible `style` branch (missing → defaults).
- [ ] **ui/overlay.ts**:
  - [ ] Convert hardcoded overlay CSS to `var(--gl-*)` with fallbacks.
  - [ ] Add `applyStyle(style)` → set CSS custom properties on the container
        (sizes, colors, font stack from preset, weight, shadow, bg opacity, bottom
        offset, line gap).
  - [ ] Call `applyStyle(loadSettings().style)` on `createOverlay()`.
  - [ ] Add a "preview mode" flag so an empty playhead shows a pinned sample cue.
- [ ] **ui/style-panel.ts (new)**: docked card (createElement/textContent, no
      innerHTML), range/color/select controls, live `input` → `applyStyle(working)`,
      Save / Reset / Close (Close reverts to saved).
- [ ] **main.ts**: `GM_registerMenuCommand('Gistlate 字幕样式', openStylePanel)`.
- [ ] Manual QA: open panel → drag each control → live change on real subtitles →
      sample pin when no cue → Save → reload applies → Reset restores defaults.
- **DoD:** AC group M1 in `prd.md` all pass. **Validation:** `pnpm compile && pnpm build` + manual.
- **Rollback point:** commit "feat: live subtitle style panel (CSS-variable driven)".

## M2 — One-shot whole-transcript translation

- [ ] **translate/openai.ts**: have `translateBatch` inspect `finish_reason`; throw
      typed `TruncationError` on `'length'`; ensure count-mismatch throws
      `CountMismatchError` after retries. Export an `isSplittable(err)` helper.
- [ ] **translate/prompt.ts**: strengthen system prompt for full-context,
      terminology-consistent translation (keep numbered format + existing rules).
- [ ] **translate/pipeline.ts**: rewrite `translateAllCues` to one-shot via
      `translateRange` recursive split (`MIN_SPLIT`, `MAX_DEPTH`); optional
      prior-half context on the split path; remove `batchSize`/`concurrency`.
- [ ] **core/resolve.ts**: update the `translateAllCues(...)` call (drop batch args).
      Keep L1→L2→translate→write-on-success + soft-fail L2 unchanged.
- [ ] **Tests (translate/pipeline.test.ts, openai.test.ts)**: rewrite for one-shot
      + fallback (mock `gmFetch`): single-call happy path, truncation→split→complete,
      persistent mismatch→throw (no partial), abort→unwind, floor respected. Mock
      the retry backoff timer to keep the suite fast.
- **DoD:** AC group M2 in `prd.md` all pass; a normal video makes exactly one
      request; small-output/truncation path still completes; fail-closed preserved.
  **Validation:** `pnpm test` + a manual run on a real monologue video.
- **Rollback point:** commit "feat: one-shot whole-transcript translation with adaptive fallback".

## Final gate (2.2 full-scope)
- [ ] Run both AC groups end-to-end on real YouTube videos.
- [ ] `pnpm compile && pnpm test && pnpm build` green; built `.user.js` still a
      single IIFE (no `@require systemjs`).
- [ ] Dispatch `trellis-check`.
- [ ] Confirm: style persists & lives; one request on DeepSeek; no partial L2 writes.

## Notes / deferred (see prd Out of scope)
- Sentence reconstruction, streaming/progress, glossary — not in this task.
- If a minimal "翻译中…" indicator is wanted, add as a tiny M2 sub-step (decide in
  planning; default: skip).
