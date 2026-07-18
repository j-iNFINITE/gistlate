# Technical Design — Stored subtitle browser

## 1. Architecture Summary

The feature remains inside the existing single-IIFE userscript and adds one
bounded UI surface over two existing data sources:

```text
current Store subtitle ───────────────┐
  progressive cues + currentTime     │
                                      ▼
                              Subtitle browser panel
L1 IndexedDB `videos` ── list/open ─▶ current transcript / local library
                                      │
                                      ├─ search + active-row projection
                                      ├─ current-video seek
                                      └─ source/translated SRT export
```

The translation pipeline remains the sole artifact writer. The browser reads
Store/L1 state and never performs translation, GitHub pool enumeration, cache
mutation or usage-history mutation.

## 2. Data Contracts

### Current Store artifact

`SubtitleState` gains optional producing-artifact context so the live view can
show the same metadata as the local library without re-reading IndexedDB:

```ts
interface SubtitleState {
  loaded: boolean
  srcLang: string
  cues: Cue[]
  artifact?: CacheEntry
}

setSubtitle(srcLang: string, cues: Cue[], artifact?: CacheEntry): void
```

`resolveTranslation` returns the accepted or newly written `CacheEntry` beside
its cues/source. Source-only progressive states and direct target-language
tracks have no artifact. Force retranslation keeps the old Store artifact until
full success, matching the existing replacement contract.

### Local L1 listing

```ts
listL1(): Promise<CacheEntry[]>
```

The listing uses the existing `gistlate/videos.createdAt` index, removes/hides
expired entries under the same 90-day policy as `getL1`, skips invalid legacy
rows safely, and returns newest-first. No database version change is required.

### Transcript and SRT projections

```ts
filterTranscriptCues(cues: Cue[], query: string): IndexedCue[]
formatSrt(cues: Cue[], channel: 'original' | 'translated'): string
```

Search is case-insensitive over both `o` and `t`, preserves source order, and
retains the original cue index for active-row mapping. SRT uses the canonical
stored display timeline, 1-based numbering and `HH:MM:SS,mmm` timestamps.
Translated export throws a typed/informative error if any target is missing or
blank; it never substitutes `cue.o`.

## 3. UI Boundary

`ui/subtitle-browser.ts` owns a singleton fixed side panel built only with
`createElement`, `textContent` and DOM event handlers. It exposes:

```ts
interface SubtitleBrowserOptions {
  getCurrentVideoId(): string | null
  getCurrentVideoTitle(): string | undefined
  seekCurrentVideo(timeMs: number): void
}

openSubtitleBrowser(options: SubtitleBrowserOptions): void
destroySubtitleBrowser(): void
```

The panel contains:

- `Current subtitles`: live Store cues, current title/languages, optional
  artifact generation/usage/cost metadata, search and two SRT actions.
- `Local library`: newest-first L1 cards. Opening a card renders its transcript
  and metadata. Cue rows seek only when the opened artifact belongs to the
  current Watch video; otherwise they remain read-only.

The UI subscribes once to Store. A cue-array/artifact identity change rebuilds
the filtered rows; playhead-only notifications update one active row and call
`scrollIntoView({ block: 'nearest' })` only when the active index changes.
`Store.reset()` notifies subscribers so SPA navigation clears stale current
content while an explicitly opened library artifact remains readable.

## 4. Entry Points and Lifecycle

- Extend the existing re-injectable player control cluster with a transcript
  button; pass its callback from `main.ts` rather than importing orchestration
  into the button module.
- Add `Gistlate 字幕浏览器` to the userscript menu.
- Both entry points call the same singleton opener with current video/title/seek
  callbacks.
- Closing the panel unsubscribes from Store and removes panel/style DOM.
- YouTube SPA navigation updates the current tab through Store reset; it does
  not forcibly close the library view.

## 5. Compatibility and Safety

- Existing L1 database/store/key schema and 500-entry/90-day limits stay intact.
- Old artifacts without `video`, `track`, `generation`, usage, pricing or cost
  render fallback labels and remain exportable when their cues are complete.
- No GitHub pool directory traversal or new remote requests are introduced.
- Subtitle cache browsing never calls `clearUsageHistory`; no clear/delete UI is
  part of this MVP.
- All UI uses Trusted Types-safe DOM construction. Imports remain static and the
  production userscript remains one IIFE.
- Object URLs created for download are revoked after the user-gesture download.

## 6. Failure and Empty States

- No active cues: explain that the user should start Gistlate or open a local
  artifact; keep the library tab usable.
- Empty local library: show a non-error empty state.
- IndexedDB listing failure: show a local-library error without breaking current
  subtitles or playback.
- No search results: show a query-specific empty state without reordering cues.
- Incomplete translated artifact: keep source export enabled and display the
  explicit translated-export error.
- Missing/invalid optional metadata: omit the field or show `unknown`; never
  throw while rendering the transcript.

## 7. Validation Strategy

- Pure tests cover search order/index preservation, SRT timestamp formatting,
  multiline normalization and incomplete-translation rejection.
- fake-indexeddb tests cover newest-first L1 listing, expiration pruning and
  legacy optional-metadata compatibility.
- Store/resolve tests prove artifact propagation, progressive replacement,
  reset notification and force-failure preservation.
- UI projection tests cover metadata fallback and seek eligibility; installed
  userscript validation covers open/close, current search/seek/highlight,
  progressive update, library open and both SRT downloads.
- Final gate: `pnpm test`, `pnpm compile`, `pnpm build`, one IIFE, zero
  SystemJS/dynamic import/HTML sinks.

## 8. Rollback

The panel and player entry are additive. They can be removed without migrating
IndexedDB or changing artifact files. The only shared contract extension is the
optional Store/resolve artifact field; callers that omit it preserve existing
subtitle behavior.
