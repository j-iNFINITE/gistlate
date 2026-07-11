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
- Settings panel uses `escapeHtml()` on all user-controlled values set via innerHTML
