# Technical Design — subtitle display polish

> Overlay/rendering changes + a cue-timing cap. CSS-variable-driven overlay stays.
> No stored-schema change. Reuses `Settings.style` for persistence.

## 1. Linger fix — cap sentence-cue duration (`translate/segment.ts`)

In `sentencesToCues`, replace the unconditional clamp-to-next-start with a capped
clamp:
```ts
const GAP_TOLERANCE = 1200 // ms a sentence may linger past its own speech
const rawEnd = last.s + last.d
const end = i < ranges.length - 1
  ? Math.min(frags[ranges[i + 1].startIdx].s, rawEnd + GAP_TOLERANCE)
  : rawEnd
const d = Math.max(1, end - first.s)
```
- Small gap (`nextStart` within tolerance): bridge to `nextStart` (no flicker).
- Overlap (`nextStart < rawEnd`): `min` picks `nextStart` (no overlap).
- **Long gap (music/silence): `min` picks `rawEnd + tolerance`** → the sentence
  disappears ~1.2s after it's spoken; the gap shows nothing.
- Still non-overlapping (`end_i <= nextStart = start_{i+1}`), so `findCueAt` binary
  search stays valid. Add a unit test for all three cases.

## 2. Control-bar-aware positioning (`ui/overlay.ts` + `main.ts`)

YouTube toggles class `ytp-autohide` on `#movie_player` when the controls hide
(present = controls hidden; absent = controls shown). We raise the subtitle while
controls are shown.

- Overlay CSS: `bottom: calc(var(--gl-bottom, 10%) + var(--gl-ctrl-offset, 0px));`
- A `MutationObserver` on `#movie_player` `class` attribute (set up on overlay
  mount, disconnected on destroy). On change:
  ```ts
  const shown = !player.classList.contains('ytp-autohide')
  container.style.setProperty('--gl-ctrl-offset', shown ? `${CTRL_OFFSET}px` : '0px')
  ```
  `CTRL_OFFSET ≈ 56px` (progress bar + control row). Debounce/throttle not needed
  (class flips are infrequent).
- Initialize the offset once on mount from the current class state.

## 3. Draggable subtitle (`ui/overlay.ts` + `settings.ts`)

- Extend `SubtitleStyle` with `hOffset: number` (px from horizontal center, default
  0). Vertical uses the existing `bottomOffset` (%). `mergeStyle` defaults both.
- Make ONLY the inner text block draggable (keep the container `pointer-events:none`
  so the rest of the video stays clickable; set the two text lines' wrapper to
  `pointer-events:auto; cursor:move`).
- Drag handler (pointer events + setPointerCapture):
  - `pointerdown`: record start pointer + current bottomOffset%/hOffset px; mark dragging.
  - `pointermove`: `dy` → new bottomOffset% = clamp(base% + (-dy / playerH * 100), 0..90);
    `dx` → new hOffset = base + dx. Live-apply via CSS vars (`--gl-bottom`,
    `--gl-hoffset`); overlay container uses `transform: translateX(var(--gl-hoffset,0px))`.
  - `pointerup`: persist `saveSettings({...loadSettings(), style:{...style, bottomOffset, hOffset}})`.
- `applyStyleToContainer` also sets `--gl-hoffset`. `createOverlay` reads persisted
  position on mount.
- Guard: a click without movement (< a few px) is not a drag — don't persist, let it
  be a normal click.

## 4. Seek sync (`main.ts`)

Add a dedicated seek handler that forces an immediate refresh (the `lastCueKey`
dedup would otherwise skip if the machine thinks the key is unchanged):
```ts
v.addEventListener('seeked', () => { lastCueKey = ''; store.setCurrentTime(v.currentTime * 1000) })
```
(Keep the existing `timeupdate` listener for normal playback.)

## Edge cases
- Overlay recreated on SPA nav → re-attach the class observer + drag handlers; read
  persisted position. Disconnect the observer in `destroy`/`destroyOverlay`.
- Fullscreen: `#movie_player` is the fullscreen element, overlay is inside it →
  positioning/observer still work. (The style *panel* is a separate known limitation.)
- Drag clamped so the subtitle can't be dragged fully off-screen.

## Testing
- Unit: `sentencesToCues` gap cap (small gap → bridges; long gap → `rawEnd+tol`;
  overlap → `nextStart`; last → `rawEnd`); `mergeStyle` includes `hOffset`.
- Manual: control-bar raise/lower; drag + reload persistence + video still clickable;
  seek jumps to correct line; long music gap no longer lingers.
