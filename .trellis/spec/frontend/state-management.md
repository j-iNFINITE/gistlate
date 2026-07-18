# State Management

> Gistlate uses a reactive singleton Store pattern for subtitle state.
> No framework (no React/Vue). State flows through a subscriber model.

## Store

A single `Store` instance (`src/core/store.ts`) holds:

- `subtitle: SubtitleState | null` — current video's cues + source language
- `currentTime: number` — playback position in ms (updated by rAF/timeupdate)
- `AbortController` — cancels in-flight translation on SPA navigation

`src/main.ts` separately owns the captured original-track snapshot:

- `CurrentTrack { videoId, srcLang, fragments }` — cleaned source fragments used
  for initial translation and explicit retranslation
- `translatingVideoId` — in-flight state only; cleared in `finally`

Do not derive `CurrentTrack` from `store.subtitle` after translation: Store cues
have already been reconstructed into sentence/display ranges and no longer
contain the original fragment boundaries required for safe retranslation.

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
- `main.ts` is the Store orchestration owner: it installs original cues, awaits
  `resolve.ts`, then replaces them with the returned cached/fresh cues
- Both `setCurrentTime()` and `setSubtitle()` notify subscribers with the current
  playhead. Progressive cue replacement repaints the current line without
  callers faking a time update.
- `AbortSignal` (via `store.signal`) is passed to all async operations
- Explicit retranslation does not call `store.reset()` and does not clear current
  cues. It replaces Store state only after full success.
- Clear `CurrentTrack` and in-flight state on genuine video navigation.

## Progressive Translation State

- Fresh work may install memory-only working cues: completed SentenceJobs have
  `t`; pending/failed jobs retain source-only cues. Store never persists them.
- `resolveTranslation` remains the only persistence owner and writes L1/L2 only
  after all jobs validate.
- Force retranslation receives progress for status rendering but must not call
  `setSubtitle` until the full replacement returns.
- Every scheduler dequeue reads the live playhead through `getCurrentTime()`;
  seeking reprioritizes pending groups, while already-running groups finish once.
- Translation-only overlay mode renders `cue.o` in the target line while `cue.t`
  is absent, avoiding a blank player during progressive work.
