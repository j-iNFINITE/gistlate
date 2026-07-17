# Component Guidelines

> Gistlate builds UI with vanilla DOM APIs mounted on the YouTube page.
> No component library. All UI is style-isolated.

## Overlay Component (`src/ui/overlay.ts`)

Mounts on `#movie_player` with two stacked divs:
- `.gl-original` — original text (white, larger)
- `.gl-translated` — translated text (blue tint, smaller)

### Pattern

```ts
export function createOverlay(): Overlay | null {
  // Idempotent: skip if already mounted
  const container = document.createElement('div')
  container.id = 'gistlate-overlay'
  // ...append children, inject scoped CSS
  player.appendChild(container)
  return {
    update(original, translated?) { /* set textContent */ },
    setDisplayMode(mode) { /* toggle class */ },
    destroy() { /* remove DOM + restore native captions */ },
  }
}
```

### Style Isolation

- All overlay CSS uses `#gistlate-overlay` as a namespace prefix
- Injected via `<style id="gistlate-styles">` in `<head>` (not inline)
- Native captions hidden with `.ytp-caption-window-container { display: none !important; }`
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
- **Don't try to make the overlay draggable via pointer events.** YouTube's
  transparent click-capture layer sits ABOVE our `z-index:40` overlay, so
  `pointer-events:auto` on the subtitle text never receives `pointerdown` — drag
  silently does nothing. (Attempted and reverted.) A future drag would need a
  higher-z handle or to hook the player's own layer.
- **Sentence-cue duration must be capped** so a subtitle doesn't linger through a
  long music/silence gap: `end = min(nextSentenceStart, rawEnd + ~1.2s)` (see the
  sentence-reconstruction rules in quality-guidelines). Keeps cues non-overlapping.
- **Force an overlay refresh on `seeked`** (reset the `lastCueKey` dedup, then push
  the new time) so the correct line shows immediately after a jump.
