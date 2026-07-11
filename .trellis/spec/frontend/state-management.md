# State Management

> Gistlate uses a reactive singleton Store pattern for subtitle state.
> No framework (no React/Vue). State flows through a subscriber model.

## Store

A single `Store` instance (`src/core/store.ts`) holds:

- `subtitle: SubtitleState | null` — current video's cues + source language
- `currentTime: number` — playback position in ms (updated by rAF/timeupdate)
- `AbortController` — cancels in-flight translation on SPA navigation

### Subscriber Pattern

```ts
const unsub = store.subscribe((currentTime: number) => {
  const cue = findCueAt(store.subtitle.cues, currentTime)
  overlay.update(cue?.o ?? '', cue?.t)
})
// Later:
unsub() // cleanup
```

### Reset

On SPA navigation or new subtitle track, call `store.reset()` to:
1. Abort any in-flight translation
2. Clear cues
3. Create a new AbortController

## Key Rules

- Store is a singleton (`export const store = new Store()`)
- Only `resolve.ts` writes `setSubtitle()`; the overlay only reads via subscriber
- `currentTime` is the only pub/sub field (triggers overlay re-render)
- `AbortSignal` (via `store.signal`) is passed to all async operations
