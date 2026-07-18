# Component Guidelines

> Gistlate builds UI with vanilla DOM APIs mounted on the YouTube page.
> No component library. All UI is style-isolated.

## Overlay Component (`src/ui/overlay.ts`)

Mounts on `#movie_player` as a player-sized pointer-transparent root containing:
- `.gl-stack` — anchored top/bottom position container
- `.gl-drag-handle` — the only pointer-interactive overlay element
- `.gl-text-box` — shared background + original/translated line ordering
- `.gl-original` / `.gl-translated` — independently styled and directed text

### Pattern

```ts
export function createOverlay(): Overlay | null {
  // Idempotent: skip if already mounted
  const container = document.createElement('div')
  container.id = 'gistlate-overlay'
  // ...append children, inject scoped CSS
  player.appendChild(container)
  return {
    update(original, translated?, { sourceLang, targetLang, directTarget }) { /* textContent */ },
    setDisplayMode(mode) { /* toggle class */ },
    destroy() { /* remove DOM + restore native captions */ },
  }
}
```

### Style Isolation

- All overlay CSS uses `#gistlate-overlay` as a namespace prefix
- Injected via `<style id="gistlate-styles">` in `<head>` (not inline)
- Native captions hidden only under `#movie_player.gistlate-active`; deactivate
  or acquisition failure removes that class immediately
- No Shadow DOM needed (YouTube's player overlay is above the video, our overlay sits on top)

## Settings Panel (`src/ui/settings-panel.ts`)

In-page modal with dark theme:
- Fixed backdrop with `z-index: 999999`
- Scoped CSS via `${PANEL_ID}` prefix on all selectors
- Form fields + "Test connection" buttons for OpenAI and GitHub
- Save via `saveSettings()` + `saveOpenAIKey()` + `saveGitHubPat()`

### Key Rules

- Always destroy/recreate the overlay on SPA navigation
- Never leave the overlay or styles in the DOM after destroy
- Build panel DOM with `createElement` + `textContent`; never use `innerHTML`

## Live-restyle via CSS custom properties

Overlay styling is driven by `--gl-*` CSS variables set on the container, not
hardcoded values. `overlay.applyStyle(style)` maps a `SubtitleStyle` →
`container.style.setProperty('--gl-o-size', ...)` etc. Changing a variable
repaints instantly with **no JS re-render** — this is what makes the style panel a
true WYSIWYG editor (every control's `input` event calls `applyStyle(working)`).
Defaults live in `DEFAULTS.style` and reproduce the baseline look via the CSS
`var(--x, fallback)`.

## Docked live panel vs modal

- **Settings (API/repo)** = full-backdrop modal (`settings-panel.ts`): blocks the
  page, fine for text config.
- **Style panel** (`style-panel.ts`) = compact **docked card** (fixed top-right,
  ~280px) that must NOT cover the subtitle area, so edits preview on the real
  on-video subtitles. Keep an in-memory `working` buffer + a `saved` baseline:
  live-apply `working`; Save persists + advances `saved`; Close reverts to `saved`.
- When both panels can be open at once, each panel's Save must re-read the other's
  latest persisted value (`loadSettings()` at save time), not a snapshot taken at
  open, or it will clobber the other's just-saved data.

## Player control-bar button

`style-button.ts` injects an "Aa" button into `.ytp-right-controls` (next to the
native settings gear) with a floating-corner fallback and a GM menu command as
last resort. Self-style the button (don't rely on `.ytp-button`, whose CSS can
hide text). See quality-guidelines "DOM injection into YouTube's player" for the
insertBefore/idempotency rules.

## Transient status pill

`status.ts` shows a non-interactive pill on `#movie_player` during a genuine
translation (cache miss or explicit force) — wired via a
`resolveTranslation(..., { onTranslating })` hook that fires just before
`translateAllCues`, so cache hits stay silent. Auto
-hides terminal states; `destroyStatus()` on SPA nav.

## Stored subtitle browser

`ui/subtitle-browser.ts` owns one fixed, responsive, Trusted Types-safe side
panel opened from both the player `文` control and the userscript menu. It has a
live current-Store view and a newest-first local-L1 view. Build all uploader and
subtitle text with `textContent`; never turn artifact fields into HTML.

Keep playhead updates cheap: rebuild rows only when the Store subtitle/artifact
identity changes, then use `findCueIndexAt` to move one active class on ordinary
time notifications. Preserve canonical cue indices through search so filtered
rows still highlight and seek correctly. An opened library artifact may seek
only when its `videoId` equals the current Watch video.

The panel owns and removes its Store subscription, root and scoped style on
close. Store reset updates the current view but does not forcibly discard a
library artifact the user is reading.

## Explicit retranslation action

Retranslation is a low-frequency, quota-consuming operation, so expose it through
`GM_registerMenuCommand('Gistlate 重新翻译当前视频', ...)`, not another permanent
player button. Require confirmation before bypassing caches. Reuse the existing
status pill while work runs and leave the current overlay cues untouched until a
complete replacement succeeds.

## Overlay positioning on the YouTube player

- **Control-bar-aware bottom offset.** YouTube toggles the `ytp-autohide` class on
  `#movie_player` (present = controls hidden, absent = controls shown). Observe it
  with a `MutationObserver` on the class attribute and raise the overlay while
  controls are shown: `bottom: calc(var(--gl-bottom) + var(--gl-ctrl-offset))`,
  `--gl-ctrl-offset` = ~56px when shown / 0 when auto-hidden. Disconnect the
  observer in `destroy`/`destroyOverlay`.
- **Drag only through the dedicated high-z grip.** YouTube's transparent
  click-capture layer sits above the old `z-index:40` subtitle text, so making the
  text draggable silently fails and also risks stealing play/pause clicks. Keep a
  player-sized `pointer-events:none` root at high z-index and enable pointer events
  only on the small grip. Persist `{anchor:'top'|'bottom', percent}`; exclude the
  temporary control-bar clearance from the stored percent and clamp on resize.
- **Sentence-cue duration must be capped** so a subtitle doesn't linger through a
  long music/silence gap: `end = min(nextSentenceStart, rawEnd + ~1.2s)` (see the
  sentence-reconstruction rules in quality-guidelines). Keeps cues non-overlapping.
- **Force an overlay refresh on `seeked`** (reset the `lastCueKey` dedup, then push
  the new time) so the correct line shows immediately after a jump.
