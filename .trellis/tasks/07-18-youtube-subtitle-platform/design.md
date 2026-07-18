# Technical Design — YouTube subtitle platform enhancements

## 1. Architecture Summary

This parent task keeps Gistlate's Tampermonkey single-IIFE architecture and adds two bounded layers:

```text
YouTube player data + observed timedtext responses
                    │
                    ▼
      Canonical track acquisition session
      select one track → fetch/POT fallback
                    │
          ┌─────────┴─────────┐
          │                   │
 target-language manual   source track
 direct display, no LLM   manual or ASR pipeline
          │                   │
          └─────────┬─────────┘
                    ▼
         Store → player overlay/settings
                    │
          full success only → L1/pool
```

The response interceptor remains a first-class input, not a deprecated compatibility shim. Active fetching and intercepted responses converge on the same selected-track session, so whichever delivers the canonical track first wins without processing it twice.

## 2. Child Task Boundaries

### A — `07-18-youtube-subtitle-acquisition`

- Page-player data contracts and video-ID validation.
- Deterministic canonical-track selection.
- Direct JSON3 request and bounded POT fallback.
- Intercepted-response staging, identity matching and deduplication.
- Manual-caption direct translation path versus ASR reconstruction path.
- Target-language manual-caption direct display with zero LLM usage.
- Source-compatible L1/pool reads and optional track metadata.

### B — `07-18-youtube-subtitle-rendering`

- Backward-compatible settings migration.
- Three display modes and original/translation ordering.
- Independent text styles, shared container effects and RTL attributes.
- Dedicated vertical drag handle with anchored persisted position.
- Current-video enable/disable, persisted auto-start and acquisition-state UI.
- Watch-page, fullscreen, resize and YouTube control-bar behavior.

SRT export belongs to `07-18-stored-subtitle-browser`; Embed and Shorts are out of scope.

## 3. Shared Contracts

The final MVP keeps current-video lifecycle ownership in `main.ts` and exposes
one bounded acquisition operation rather than adding a second session-state
abstraction beside the existing Store:

```ts
interface AcquireOptions {
  signal?: AbortSignal
  onStage?: (stage: AcquisitionStage) => void
}

acquireCurrentSubtitles(videoId, targetLanguage, options):
  Promise<AcquiredSubtitles>
```

`main.ts` owns the active/suppressed video IDs and resets the Store to obtain one
AbortSignal per activation. Navigation, deactivation or replacement aborts both
acquisition and translation. Acquisition publishes stage callbacks; translation
may publish source cues progressively, but only a completely successful
translation produces an artifact.

Track selection returns both identity and purpose:

```ts
type TrackPurpose = 'direct-target' | 'translate-manual' | 'translate-asr'

interface SelectedCaptionTrack {
  identity: { videoId: string; languageCode: string; kind: 'manual' | 'asr'; vssId: string }
  purpose: TrackPurpose
  baseUrl: string
}
```

`direct-target` publishes the existing target-language manual cues to the Store and never enters `resolveTranslation`, the usage ledger, L1 or L2 writes.

## 4. Compatibility Invariants

- Pool path remains `data/{shard}/{videoId}.{src}-{tgt}.json`.
- Existing `{s,d,o,t}` cues and optional generation metadata remain readable.
- New translated artifacts may add optional track identity and source fingerprint metadata.
- Every L1/L2 hit is checked against the selected canonical source text before use. New entries use their fingerprint; old entries are validated from their stored `cue.o` content. A mismatch is a cache miss, never a silent hit.
- Artificial/manual cues are complete translation owners. ASR word-timed cues retain the existing complete-sentence-owner → short-display-range model.
- Usage/cost recording, complete-only artifact writes, temperature `0`, static imports and the one-IIFE build remain unchanged.

## 5. Main Lifecycle

1. The userscript always mounts lightweight player controls on a normal Watch page.
2. `autoStart=true` (the compatibility default) starts the current video session. `autoStart=false` waits for the user.
3. Player data is accepted only when its `videoDetails.videoId` matches the URL video ID.
4. The selector chooses one canonical track from the complete track list.
5. An intercepted matching JSON3 response may satisfy the session; otherwise the active fetcher requests the selected `baseUrl`.
6. If the request needs POT, the session uses already observed POT, matching audio-caption metadata, controlled CC enable/polling and finally a bounded timedtext wait before one POT-backed retry sequence.
7. A target-language manual track displays immediately. A source manual track translates each cue directly. An ASR track uses the existing timed segmentation and reconstruction pipeline.
8. Navigation or current-video disable aborts the session, clears the overlay and restores native captions. With auto-start on, the next video starts normally.

## 6. Rollback and Failure Behavior

- Active fetching lives behind the acquisition session; intercepted subtitle responses remain usable when player methods or direct requests fail.
- HTTP/POT failures end with a typed acquisition error and no cache write. When no Gistlate source cues are available, native YouTube captions are restored.
- A failed force retranslation keeps the prior complete artifact and on-screen result.
- Settings migration is read-compatible and non-destructive; the legacy shape can still be interpreted even after the new shape is introduced.
- No IndexedDB version bump or pool-path migration is required.

## 7. Validation Strategy

- Pure unit tests cover track selection, URL/POT handling, source compatibility, manual/ASR branching, settings migration, display decisions, direction and position math.
- Integration-style tests cover active/intercept races, abort/staleness guards, direct-target zero-usage behavior, activation state and native-caption restoration.
- Real Watch-page checks cover one manual-caption video, one word-timed Google ASR video, one target-language manual-caption video, a POT-required path if reproducible, SPA navigation, seeking and fullscreen.
- Final gate: `pnpm test`, `pnpm compile`, `pnpm build`, one IIFE, no SystemJS and no dynamic import.
