# Technical Design — subtitle rendering and settings

## 1. Settings Model and Migration

Keep API/GitHub/translation settings intact. Extend display settings with:

```ts
type DisplayMode = 'bilingual' | 'original-only' | 'translation-only'
type TranslationPosition = 'above' | 'below'

interface SubtitleTextStyle {
  fontFamily: string
  size: number
  color: string
  fontWeight: number
}

interface SubtitlePosition {
  anchor: 'top' | 'bottom'
  percent: number
}

interface SubtitleStyle {
  original: SubtitleTextStyle
  translation: SubtitleTextStyle
  translationPosition: TranslationPosition
  outline: number
  bgOpacity: number
  lineGap: number
  position: SubtitlePosition
}
```

Add `Settings.autoStart`, default `true` for behavioral compatibility. Do not add a second persistent master-enabled flag: player enable/disable is current-video session state; `autoStart` controls whether each newly navigated video begins automatically.

Legacy migration:

- old shared `fontFamily` and `fontWeight` seed both nested text styles;
- `originalSize/Color` and `translatedSize/Color` seed their respective styles;
- old `bottomOffset` becomes `{anchor:'bottom', percent:bottomOffset}`;
- translation order defaults to `below`, matching the current original-then-translation DOM order;
- display mode and all numerical values are validated/clamped;
- background default remains current `0`, not Read Frog's `75`, to avoid a visual surprise.

## 2. Overlay DOM and View Model

Keep vanilla DOM and CSS variables. The overlay becomes:

```text
player-sized root (absolute, pointer-events:none)
└─ positioned stack (top/bottom anchor)
   ├─ small grip handle (pointer-events:auto)
   └─ rounded text container (shared background)
      ├─ original line
      └─ translation line
```

The root is player-sized and clips position calculations, not text overflow. The grip handle alone receives drag input; subtitle text may remain selectable only if that does not steal normal player clicks. The existing failed approach—making the subtitle text itself draggable—is not repeated.

Build a pure overlay view model from current cue, display mode and track purpose:

- bilingual: show available original and translation; pending translation shows original only;
- original-only: show original;
- translation-only: show translation, falling back to original while a fresh translation is pending so the screen never goes blank;
- direct-target: show one target-language line using the translation/primary style, without duplicating it as both original and translation;
- identical original/translation strings are not rendered twice.

`translationPosition` changes flex order, not cue ownership or persistence.

## 3. Typography, Language and Direction

Expose independent original/translation font family, size, color and weight. Keep shared outline/shadow, line gap and one container background opacity.

The overlay session supplies source and target language codes. Set `lang` and `dir` separately on each line. Direction is derived from the base language using a maintained RTL set (Arabic, Hebrew, Persian, Urdu and related scripts); unknown languages use safe automatic text direction. Target-direct uses the target language on its single visible line.

## 4. Anchored Vertical Drag

Persist `{anchor, percent}` rather than raw pixels:

- bottom anchor is the compatibility default;
- dragging crosses the vertical midpoint by converting to the opposite anchor without a visual jump;
- stored percent excludes the temporary YouTube control-bar clearance;
- clamp against actual player height and current subtitle container height;
- use `ResizeObserver` to recompute/clamp on player resize and fullscreen changes;
- measure the visible controls region when possible, with the current `56px` only as fallback;
- only a left-button/pointer drag on the grip begins movement; stop propagation and capture that pointer.

The player root remains click-through outside the small handle, so ordinary click-to-play behavior is preserved.

## 5. Player Controls and Settings Panel

Replace the style-only entry with an idempotent Gistlate control group near YouTube settings:

- activation button with `aria-pressed`, active/inactive title and current session state;
- `Aa` settings button opening a consolidated subtitle panel.

The panel includes display mode, translation order, auto-start, independent text styles, shared background/outline/gap and position reset. It retains live preview, Save, Reset and Close/revert behavior. API key, model and GitHub settings stay in the existing userscript settings dialog.

Mount the player panel inside `#movie_player` (or its current fullscreen root) so it remains visible in fullscreen. Build all DOM with `createElement`/`textContent`; no `innerHTML` or dynamic imports.

## 6. Activation Semantics

- On initial load/navigation, `autoStart=true` starts the session; `false` leaves it inactive with controls available.
- Clicking activate starts only the current video's session.
- Clicking deactivate aborts acquisition/translation, clears Gistlate overlay/status and restores native captions. Already completed L1/pool data remains untouched.
- With auto-start on, a manual deactivation suppresses only the current video; polling/control remount must not immediately restart it. The next video auto-starts.
- Changing auto-start affects future video starts. It does not unexpectedly abort an already active current video.
- Aborted translation finalizes the usage attempt as aborted with any actual provider usage already recorded.

Hide native captions through an active-player class rather than an unconditional global rule. Inactive/no-source acquisition errors remove that class so YouTube captions remain usable.

## 7. State Feedback

Extend the existing transient pill to represent:

- waiting for player/caption list;
- fetching subtitles;
- waiting for YouTube authorization/POT;
- direct target captions ready;
- boundary analysis, translation and alignment progress;
- completion;
- no captions/player unavailable/POT or translation error.

Long-running states persist until transition; success and terminal errors auto-hide. The activation button remains the durable active/inactive indicator.

## 8. Tests

- Legacy/partial/malformed settings migrate to compatible defaults and clamp values.
- View-model tests cover all three modes, pending translation, direct-target and duplicate suppression.
- Direction helper covers `ar`, `he`, `fa`, `ur`, Chinese and unknown codes.
- Pure position math covers top/bottom anchors, midpoint crossing, controls offset and resize clamping.
- Activation controller covers default auto-start, auto-start off, manual current-video start, current-video suppression, navigation and stop abort.
- DOM tests or focused helpers verify idempotent controls and active-class/native-caption restoration.
