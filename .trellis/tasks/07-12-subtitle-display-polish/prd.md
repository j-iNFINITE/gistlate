# Subtitle display polish

## Goal

Polish how the bilingual overlay is displayed on the YouTube player, and fix a
subtitle that **lingers through long silent/music gaps**. Borrowed from
`kiss-translator`'s display layer. No stored-schema change.

## Background

- The overlay is a custom DOM element on `#movie_player` (native captions hidden).
- The **linger bug** is a side effect of the sentence-reconstruction time clamp:
  `sentencesToCues` sets a non-last sentence's end to the NEXT sentence's start, so
  during a long gap (music/silence) the sentence stays on screen until the next one
  begins.

## Requirements

- **R1 — Linger fix (cap sentence duration).** In `sentencesToCues`, clamp the end
  to `min(nextSentenceStart, rawEnd + GAP_TOLERANCE)` where `rawEnd = last.s + last.d`
  and `GAP_TOLERANCE ≈ 1200ms`. So: small gaps bridge to the next sentence (no
  flicker), overlaps clamp to the next start (no overlap), and **long gaps let the
  sentence disappear ~1.2s after it is actually spoken** (nothing shows during the
  gap). Last sentence uses `rawEnd`.
- **R2 — Control-bar-aware positioning.** When the player's control bar is visible,
  raise the subtitle so it is not covered; when the controls auto-hide, return to the
  base position. Track YouTube's `ytp-autohide` state on `#movie_player` and apply an
  extra bottom offset while controls are shown.
- **R3 — Draggable subtitle.** Let the user drag the subtitle to reposition it
  (vertical at minimum; horizontal optional), and **persist** the position so it
  applies on reload. Dragging must not permanently block clicking the video.
- **R4 — Seek sync.** After the user seeks, the overlay must immediately show the cue
  at the new time (no stale line). Force a refresh on `seeked`.

## Constraints

- Vanilla TS; single-IIFE build (no dynamic import); Trusted Types safe (no
  innerHTML). CSS-variable-driven overlay stays.
- Persist position via the existing `Settings.style` (extend it), backward
  compatible (missing → defaults).
- No stored artifact schema change; `findCueAt` stays binary-search-valid
  (non-overlapping cues).

## Acceptance Criteria

- [ ] During a long music/silence gap between sentences, the previous subtitle
      **disappears shortly after it finishes** (does not linger the whole gap);
      adjacent close sentences still switch cleanly with no flicker; no overlap.
- [ ] When the player controls appear, the subtitle moves up and is not hidden
      behind the control bar; when controls auto-hide, it returns to base position.
- [ ] The subtitle can be dragged to a new position; the position persists across
      reload; the video can still be clicked/played normally after dragging.
- [ ] After seeking, the overlay shows the correct cue for the new time immediately.
- [ ] Build is a single IIFE; tests green; `sentencesToCues` timing has a unit test
      for the gap cap.

## Out of scope

- Ad-time hiding, word-hover dictionary, transcript sidebar (not this round).
- Word-level re-segmentation (that's the word-level-segmentation child).
