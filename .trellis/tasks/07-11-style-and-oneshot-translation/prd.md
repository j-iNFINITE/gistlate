# Gistlate: live subtitle style panel + one-shot whole-transcript translation

## Goal

Two independent improvements to the shipped Gistlate MVP:

- **M1 — Live subtitle style customization.** Let users customize the bilingual
  overlay's font, size, color, position, etc. via a **docked, live (WYSIWYG)
  panel** that restyles the *real* on-video subtitles as they drag controls.
- **M2 — One-shot whole-transcript translation.** Replace the fixed 40-cue
  batching + concurrency pool with a **single whole-video request** (full context
  → coherent, terminology-consistent translation), plus an **adaptive recursive
  fallback** for models with small output caps.

Both build on the existing userscript (see prior task
`archive/2026-07/07-09-gistlate-mvp`). Streaming/perceived-speed work was
explicitly dropped — the user is fine waiting for a complete translation.

## Background / decisions (from brainstorm)

- Target content is often **monologue/narration**; per-cue independent translation
  (current behavior) hurts quality because cues are sentence fragments.
- **DeepSeek V4**: 1M input context, **384K output tokens** → no realistic video
  needs chunking; one-shot is optimal and cheapest (system prompt sent once).
- The tool is OpenAI-compatible, so a user may configure a small-output model
  (e.g. gpt-4o-mini, 16K). We therefore **do not hardcode token caps**; we detect
  truncation/line-count failure and adaptively split.
- One-shot subsumes the need for rolling-context / summaries / glossaries.

## Requirements

### M1 — Live subtitle style panel (WYSIWYG, approach A)

- R1.1 A dedicated **style panel** distinct from the API/repo settings modal,
  opened via a GM menu command (e.g. `Gistlate 字幕样式`) and/or a gear on the overlay.
- R1.2 The panel is a **compact docked card** that does **not** cover the subtitle
  area, so the real subtitles stay visible while editing.
- R1.3 Controls, each applying **live** to the real overlay as they change:
  - Font family (presets: system sans / serif / mono / YouTube Noto / custom name)
  - Original font size, Translated font size (independent)
  - Original color, Translated color
  - Font weight (normal / bold)
  - Outline/shadow strength (readability on bright video)
  - Background box opacity (0–~0.8)
  - Vertical position (offset from bottom)
  - Gap between original and translated lines
- R1.4 When no subtitle is currently on screen, the panel **pins a sample cue** so
  there is always something to preview.
- R1.5 Actions: **Save** (persist), **Reset to defaults**, **Close**. Defaults
  reproduce the current MVP look.
- R1.6 Styles persist in GM storage (extend `Settings` with a `style` object) and
  apply on script load for every video.
- R1.7 Live restyle is instant (CSS-variable driven; no re-render, no reload).

### M2 — One-shot whole-transcript translation

- R2.1 Translate the **entire cue list in a single request** by default (numbered
  input/output, full-video context).
- R2.2 Prompt instructs the model that lines are consecutive subtitles of one
  video; translate coherently with consistent terminology.
- R2.3 Parse numbered output, **validate line count**, retry on mismatch (existing
  behavior preserved).
- R2.4 **Adaptive fallback (no hardcoded caps):** if a response is truncated
  (`finish_reason === 'length'`) or returns fewer lines than requested, **split the
  range in half and translate each half**, recursively, down to a floor. Earlier
  halves' text may be passed as context to later halves.
- R2.5 Preserve the **write-on-full-success invariant**: L1/L2 are written only
  after every cue has a non-empty translation. No partial uploads.
- R2.6 Preserve `AbortSignal` cancellation on SPA navigation.
- R2.7 Remove the fixed `batchSize=40` + concurrency-pool code path (replaced by
  one-shot + fallback).

## Constraints

- No new runtime dependencies; vanilla TS; keep the single-file IIFE build (no
  dynamic imports → avoid SystemJS/Trusted Types issues).
- All style CSS stays namespaced under `#gistlate-overlay`; no `innerHTML` on
  YouTube pages (Trusted Types) — build DOM via `createElement`/`textContent`.
- Backward compatible with existing L1/L2 artifacts (`{key,videoId,src,tgt,model,
  cues,createdAt}`); this task does not change the stored schema.

## Acceptance Criteria

### M1
- [ ] The style panel opens from the GM menu and docks without covering subtitles.
- [ ] Dragging any control restyles the live on-video subtitles **instantly**.
- [ ] With no active subtitle, a sample cue is pinned for preview.
- [ ] Save persists; after reload, the chosen styles apply automatically.
- [ ] Reset restores the MVP default look.
- [ ] Secrets/other settings are untouched by the style panel.

### M2
- [ ] A normal video (e.g. ~150–350 cues) is translated in **one** OpenAI request
      (verify single call in logs), producing a full bilingual track.
- [ ] Translation quality on a monologue video is visibly more coherent than the
      per-batch MVP (spot-check terminology/pronoun consistency).
- [ ] With a small-output model or an injected truncation, the fallback splits and
      still completes the full track (no missing lines).
- [ ] A hard failure still writes **nothing** to L2 (write-on-success preserved).
- [ ] SPA navigation mid-translation aborts cleanly; no stale writes.
- [ ] The old fixed-40 batching/concurrency code is removed.

## Out of scope

- Sentence reconstruction / re-segmentation (display full sentence across cues) —
  deferred; revisit after seeing one-shot quality.
- Streaming / window-first translation + progress indicator (dropped this round).
- Rolling summaries, glossary extraction (subsumed by one-shot full context).
- Web-font loading from URLs (custom family = OS-installed names only for MVP).
- Terminology glossary UI.

## Open questions (resolve in design/planning)

- Keep a minimal "翻译中…" indicator, or nothing? (User leaned "can wait"; TBD.)
- Recursive fallback floor (min lines per request) and whether to carry prior
  halves as context in the fallback path.
- Exact style control ranges/defaults.
