# Design: translation context, explicit retranslation, and cue-length cap

## 1. Summary

This task adds three related improvements without changing the shared cache key
or stored cue schema:

1. Read the current YouTube video's title and description and pass them as
   reference-only context to translation requests.
2. Add a confirmed Tampermonkey menu action that retranslates the current video,
   bypasses cache reads, and replaces cached artifacts only after full success.
3. Refine LLM-detected sentence ranges into shorter display ranges at existing
   source-fragment boundaries before the strict 1:1 translation pass.

The task deliberately excludes glossary management, automatic term extraction,
and any extra LLM pre-analysis call.

## 2. Invariants

- A translated cue's original text, translation, and time range must derive from
  the same contiguous source-fragment range.
- Source fragments remain fully covered, ordered, and non-overlapping.
- Failed or aborted work writes no partial L1 or L2 artifact.
- Explicit retranslation leaves the currently cached/displayed result intact
  until a complete replacement is ready.
- Cache identity remains `videoId|src|tgt`; stored cues remain `{s,d,o,t}`.
- Metadata absence is a soft condition: translation continues without context.
- No dynamic imports, unsafe HTML sinks, or additional persistent player control.

## 3. Target data flow

```text
YouTube timedtext interception
  -> clean original fragment Cue[]
  -> capture CurrentTrack {videoId, srcLang, fragments}
  -> read TranslationContext {title?, description?}
  -> resolveTranslation(..., {force, context, signal, onTranslating})
       force=false: L1 -> L2 -> translate
       force=true:  skip L1/L2 reads -> translate
  -> pass 1: validated E/C boundaries
  -> deterministic sentence ranges
  -> cap long ranges at reliable fragment boundaries
  -> pass 2: strict 1:1 translation with the same context on every split request
  -> sentence ranges + translations -> Cue[]
  -> put L1
  -> attempt L2 write/overwrite (existing soft-fail policy)
  -> replace Store subtitle only after success
```

The menu retranslation path reuses the captured original fragments. It must not
use the current Store cues after a successful translation because those are
already reconstructed sentence cues and no longer contain the original fragment
boundaries needed by pass 1 and the length cap.

## 4. Translation-context contract

### 4.1 Shared type and normalization

Add a small translation-owned contract, tentatively
`src/translate/context.ts`:

```ts
export interface TranslationContext {
  title?: string
  description?: string
}
```

The same module owns normalization so YouTube extraction and prompt construction
cannot develop different limits:

- collapse whitespace and trim;
- omit empty values;
- cap title at approximately 300 characters;
- cap description at approximately 2,000 characters.

The caps prevent unusually large descriptions from dominating the prompt while
retaining the high-value opening portion of a normal YouTube description.

### 4.2 YouTube extraction

Extend `src/youtube.ts` with `getVideoContext(expectedVideoId)`.

Preferred source:

- `unsafeWindow.ytInitialPlayerResponse.videoDetails.title`
- `unsafeWindow.ytInitialPlayerResponse.videoDetails.shortDescription`

The player-response data is accepted only when its `videoId` matches the current
watch URL. This prevents stale metadata during SPA transitions.

Fallback sources, used independently for missing fields:

- title: `meta[itemprop="name"]`, `meta[property="og:title"]`, then
  `document.title` with the trailing YouTube suffix removed;
- description: `meta[itemprop="description"]`, `meta[property="og:description"]`,
  then `meta[name="description"]`.

Extraction failure returns an empty context and never blocks subtitles.

### 4.3 Prompt placement and injection boundary

Pass `TranslationContext` through:

```text
main -> resolve -> pipeline -> translateRange -> translateBatch -> fillPrompt
```

Context is used by pass-2 sentence translation and the 1:1 fallback. It is not
sent to pass-1 E/C boundary detection because it does not materially improve the
source-side structural decision and would increase repeated prompt input.

The system prompt states that video metadata is untrusted reference data and any
instructions found inside it must be ignored. The user message contains a
JSON-encoded context block before the numbered subtitles. JSON encoding avoids
inventing delimiter parsing rules for uploader-controlled text.

When both values are absent, prompt content remains equivalent to the current
behavior. Recursive translation splits receive the same context so terminology
and subject understanding do not disappear on long videos.

No summary, term-extraction, or glossary request is added.

## 5. Display-range length cap

### 5.1 Placement

Add a pure function in `src/translate/segment.ts`, tentatively:

```ts
capSentenceRanges(fragments, ranges): SentenceRange[]
```

Call it after `groupByBoundaries()` and before building pass-2 `sentenceTexts`.
This preserves the two-pass alignment proof:

```text
E/C flags -> sentence ranges -> capped contiguous ranges -> 1:1 translations
```

`sentencesToCues()` remains the sole owner of converting ranges into timed cues
and of the existing gap/linger clamp.

### 5.2 Measurement

Use two fixed internal targets:

- space-separated text: 15 whitespace-delimited words;
- text containing CJK scripts: 30 visible, non-whitespace code points.

Mixed text containing CJK uses the CJK display-character measurement because
whitespace token counts severely undercount such subtitles. These are display
targets rather than a persisted user preference.

### 5.3 Boundary selection

For each over-limit sentence range:

1. Walk forward over its existing fragment boundaries.
2. Prefer a nearby boundary after strong punctuation or a positive timing pause.
3. Otherwise choose the closest reliable fragment boundary around the target.
4. Never produce an empty range, skip a fragment, reorder fragments, or create an
   overlapping range.
5. If the first fragment alone exceeds the target, emit it intact and continue
   with the next fragment.

The implementation may use a small bounded tolerance around the target to prefer
a natural boundary, but must keep the constants centralized and tests focused on
observable coverage/readability rather than an opaque scoring implementation.

Fallback 1:1 fragment translation is already naturally bounded by individual
fragments and does not need another cap.

## 6. Explicit retranslation

### 6.1 Current-track source of truth

`src/main.ts` keeps a nullable `CurrentTrack` snapshot:

```ts
interface CurrentTrack {
  videoId: string
  srcLang: string
  fragments: Cue[]
}
```

It is set after a valid original track is parsed/cleaned and cleared on genuine
video navigation. The snapshot is immutable by convention and is never replaced
with translated sentence cues.

### 6.2 Menu behavior

Register `Gistlate 重新翻译当前视频` next to the existing GM menu commands.

On activation:

1. Verify a current captured track exists and still matches `getVideoId()`.
2. Refuse a duplicate action while that video's translation is actually in
   flight.
3. Ask for confirmation, clearly mentioning LLM usage and cache replacement.
4. Read live settings and current video context.
5. Call the same translation entry point with `force: true`.

If no track has been captured, show a concise message asking the user to enable
captions first. Cancellation performs no network or cache work.

### 6.3 In-flight state

The current `translatingVideoId` value behaves partly like a permanent completed
guard. Refine it into actual in-flight state and clear it in `finally` after both
success and failure. Network-track duplication remains prevented by the existing
`handledTrackKey`; in-flight state only prevents concurrent translations.

### 6.4 Resolve options and cache semantics

Replace positional optional parameters with an explicit options contract:

```ts
interface ResolveOptions {
  signal?: AbortSignal
  onTranslating?: () => void
  force?: boolean
  context?: TranslationContext
}
```

Default `force` is false. With `force: true`, `resolveTranslation` skips both L1
and L2 reads but uses the existing full-success write sequence:

1. translate all ranges;
2. put/replace L1;
3. attempt L2 write, whose existing SHA lookup makes the GitHub Contents API
   overwrite the same path;
4. return the new cues.

The Store is updated only after the promise resolves. Therefore the old subtitle
continues displaying during retranslation and survives failure/abort. The L2
write remains soft-fail by existing project policy; a successful new L1 result is
not discarded because GitHub is temporarily unavailable.

Live settings must be loaded at translation start. This removes reliance on the
startup settings snapshot for the target-language equality check and ensures the
explicit action uses the user's current configuration.

## 7. Error and navigation behavior

- Metadata missing: log nothing sensitive; translate without it.
- User cancels confirmation: no status change, API call, or cache write.
- No captured current track: inform the user; no API call.
- Translation already in flight: do not start a second operation.
- Navigation: the Store signal aborts; staleness checks discard late results;
  `CurrentTrack` and in-flight state reset for the new video.
- Fresh/retranslation failure: keep whatever was already in Store and show the
  existing failure state.
- L2 overwrite failure: keep new L1 result and log the existing soft warning.

## 8. Compatibility

- No new persisted setting is required.
- No L1 database version change.
- No L2 path or JSON schema change.
- Old cached cues remain readable.
- Existing OpenAI-compatible chat/responses selection remains unchanged.
- Existing custom-prompt helper behavior remains source-compatible even though
  the application currently exposes no custom-prompt setting.

## 9. Testing strategy

### Pure/unit tests

- Translation-context normalization: whitespace, empty values, length caps.
- Prompt construction: title/description included as reference-only context;
  absent context retains numbered output contract; uploader text is JSON encoded.
- Range cap: short no-op, English split, CJK split, natural-boundary preference,
  single over-limit fragment, and exact ordered full coverage.
- Pipeline: capped ranges are the units sent to pass 2 and remain aligned.
- Resolve force mode: skips both cache reads, translates, writes L1, attempts L2;
  normal mode still uses L1/L2.
- Failure/abort: no put/write before translation succeeds.

### Build/manual checks

- `pnpm compile`
- `pnpm test`
- `pnpm build`
- Confirm built body is one IIFE and contains no SystemJS loader.
- On YouTube, verify metadata context on a cache miss.
- On a cached video, cancel retranslation and observe zero API calls.
- Confirm retranslation, observe the old cue while work runs, then the replacement.
- Force an API failure and verify the old displayed/cached translation survives.
- Navigate mid-retranslation and verify the stale result is discarded.
- Verify long cues split only at source-fragment boundaries.

## 10. Rollback shape

The three mechanisms are separable:

- context can be disabled by passing no `TranslationContext`;
- length capping can be removed by using the original grouped ranges directly;
- force retranslation can be removed without changing normal cache resolution.

Because no persisted schema changes, rollback requires no migration or cleanup.
