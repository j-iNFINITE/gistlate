# Technical Design — subtitle acquisition and track identity

## 1. Problem Restatement

Gistlate must obtain one high-quality subtitle track for the current Watch video even when YouTube does not voluntarily issue a readable JSON3 request, and it must choose that track before any cache read, translation or artifact write.

## 2. Player Data Access

Add a YouTube player-data adapter around the page's `#movie_player` object. Because the Tampermonkey script already has `unsafeWindow` access and patches page-world `fetch`/XHR directly, do not copy Read Frog's WXT MAIN-world `postMessage` bridge. Access the player through `unsafeWindow`/page DOM and feature-detect:

- `getPlayerResponse()`
- `getAudioTrack()`
- `getPlayerState()`
- `getOption('captions', 'track')`
- `getWebPlayerContextConfig()`
- `toggleSubtitles()` when available

Use `ytInitialPlayerResponse` only as a fallback. In every case, require `playerResponse.videoDetails.videoId === expectedVideoId` before returning tracks or metadata.

Normalized player data contains:

- caption track `baseUrl`, `languageCode`, `kind`, `vssId`, optional display name;
- selected caption `vssId`/language only as a tie-breaker;
- active/default audio language or the caption indices associated with the active audio track when YouTube exposes them;
- audio-caption URLs that may carry `pot/potc`;
- player state, device parameters and client version;
- last observed timedtext URL for the same video.

All optional, unstable YouTube fields are parsed defensively. Failure to obtain one optional field must not invalidate an otherwise usable caption track list.

## 3. Canonical Track Selection

Track selection is a pure function over the complete track list, normalized target language and best-known audio language. It returns one `SelectedCaptionTrack` and never changes merely because YouTube later requests another track.

Priority:

1. Human/manual track whose normalized language equals the configured target language → `direct-target`.
2. Human/manual track matching active/original audio language → `translate-manual`.
3. Other human/manual tracks, with deterministic tie-breaks: YouTube default/unnamed, current selected, then original array order → `translate-manual`.
4. ASR matching active/original audio language → `translate-asr`.
5. Selected or first available ASR → `translate-asr`.

Every manual candidate remains ahead of every ASR candidate except that step 1 is a no-translation shortcut. Language comparison uses Gistlate normalization, so `zh-CN` can match `zh-Hans` and regional forms use the project's established semantics.

Runtime identity is:

```text
videoId : normalized languageCode : manual|asr : vssId
```

If `vssId` is absent on an observed URL, match by video/language/kind only when that tuple uniquely identifies the already selected canonical track. Ambiguous responses stay staged and cannot satisfy the session.

## 4. Interception and Active Fetch Convergence

Refactor the existing observe-only hook into two outputs:

- request observation: remember same-video timedtext URLs containing POT and notify POT waiters;
- successful JSON3 observation: stage `{url, params, json}` under derived track identity.

The hook still forwards the original Request/XHR untouched and clones only responses. Auto-translated requests carrying `tlang` do not become canonical source candidates.

The `main.ts` activation owns the AbortSignal; the bounded acquisition operation
waits for complete player data, selects one track, then:

1. consumes an already staged matching response if present;
2. otherwise starts a direct request for the selected `baseUrl`;
3. accepts a matching intercepted response if it arrives first and aborts/ignores the redundant direct result;
4. delivers the track exactly once.

When player APIs remain unavailable, the interception fallback waits a short bounded discovery interval, chooses the best observed manual candidate, or an ASR candidate only when no manual candidate appears. This preserves current interception behavior without letting the first ASR request permanently beat a later manual request. Stage updates flow through `AcquireOptions.onStage`; stop/navigation is the caller aborting the shared Store signal, so no duplicate session state or subscription layer is introduced.

## 5. Direct JSON3 and POT Fallback

Build from the selected `baseUrl` and set Read Frog's proven request parameters:

```text
fmt=json3, xorb=2, xobt=3, xovt=3, c=WEB, cplayer=UNIPLAYER
```

Copy available device parameters (`cbrand`, `cbr`, `cbrver`, `cos`, `cosver`, `cplatform`) and `cver`. Perform the request through existing `gmFetch` with the session AbortSignal, avoiding CORS issues and avoiding a duplicate pass through YouTube's patched `fetch`.

Fast path: request once without forcing CC or waiting for POT. Validate HTTP status, JSON shape, non-empty events and current session identity.

Fallback after an authorization/empty-response failure:

1. use POT already present on the matching track/audio-caption URL;
2. use a same-video POT URL already observed by the network hook;
3. wait for usable player state;
4. if the session is active, enable CC once via `toggleSubtitles()` or the button;
5. poll player audio-caption data for matching `pot/potc` for a bounded interval;
6. wait a final bounded interval for YouTube's own timedtext request;
7. rebuild the selected track URL with the recovered POT and retry transient failures with capped backoff.

Do not repeatedly click CC. `403/404/429` handling is explicit; stale video IDs and AbortError terminate immediately. No empty response is published as a track.

## 6. Manual, ASR and Direct-Target Processing

The selected track kind is passed explicitly into parsing and translation planning.

### Manual source

- Use one visible YouTube cue as one complete semantic translation owner.
- Skip the boundary prompt entirely and report `boundaryMethod: 'manual-cues'`, request count `0`.
- Preserve source cue timing. Do not merge adjacent manual cues merely to create more context; the stable whole-video prompt already provides transcript context.
- A long manual cue remains one owner/display cue because no trustworthy intra-cue timing exists.

### ASR source

- Preserve the current word-timed parser, `tOffsetMs`, punctuation boundaries and complete-sentence planning.
- Untimed ASR may still use the validated boundary LLM path.
- Preserve canonical target ownership and cut-only display alignment.

### Target-language manual track

- Clean and publish cues directly to Store with a `direct-target` role.
- Render as the target/primary visible line.
- Do not call `resolveTranslation`, begin a usage operation, read/write translation caches or show a translation-complete claim.

## 7. Cache and Artifact Safety

Keep the existing L1 key and GitHub path. Extend `CacheEntry` with optional source metadata, for example:

```ts
track?: {
  languageCode: string
  kind: 'manual' | 'asr'
  vssId: string
  sourceFingerprint: string
}
```

Compute a versioned SHA-256 fingerprint over normalized ordered `cue.o` text. Normalization joins cue texts with one space, applies Unicode normalization and collapses whitespace, preserving words and punctuation while ignoring display-range regrouping.

Before returning any L1/L2 entry:

- new entry: compare recorded fingerprint to current canonical source fingerprint;
- old entry without metadata: compute the same fingerprint from stored `cue.o` and compare;
- mismatch: log a source-incompatible miss and continue to fresh translation;
- match: accept, preserving old artifact compatibility.

Fresh full success writes the optional track metadata to the existing canonical path. A failure never overwrites the previous artifact.

## 8. Tests

- Player response accepts matching video IDs and rejects stale SPA data.
- Selection matrix covers target manual, audio-language manual, unnamed/selected manual, audio-language ASR and final ASR fallback.
- Identity matching rejects ambiguous missing-`vssId` responses.
- URL builder and POT extraction prefer matching vssId, then language/kind, then same language.
- Network observation caches POT even when response body is not JSON and still preserves pass-through behavior.
- Active/intercept race publishes once; navigation and user stop abort both paths.
- Manual track produces one plan per cue and zero boundary usage; ASR behavior remains unchanged.
- Target-language direct display creates no usage operation or artifact write.
- New and legacy cache entries hit only when source content matches.
