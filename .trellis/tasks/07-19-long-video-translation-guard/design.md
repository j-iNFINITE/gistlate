# Design: long-video translation budget guard

## 1. Summary

Add a zero-provider-cost preflight between compatible L1/L2 misses and the
existing usage/translation pipeline. The preflight classifies the cleaned
caption source as an ordinary finite video, a finite replay over the configured
caption-span limit, or a current live/indefinite stream. Ordinary work proceeds
unchanged. A guarded fresh activation returns a typed skip result, tears down
the Gistlate source-only overlay, and reveals YouTube native captions. The
existing `GL` control remains the explicit entry for a one-operation override
of finite long replays.

The default automatic finite-replay limit is 45 minutes. The settings panel
offers 15/30/45/60/90/120 minutes and unlimited finite replays. Live streams
cannot be manually overridden in this MVP.

## 2. Hard invariants

1. Caption acquisition, direct-target display and compatible L1/L2 reads happen
   before the guard; these zero-provider-cost paths never prompt.
2. A guarded or declined preflight runs before `onTranslating`, secret loading,
   `beginUsageOperation`, provider calls and artifact writes.
3. One confirmation authorizes exactly one fresh provider operation. No bypass
   is persisted or reused after failure, abort, navigation or force retry.
4. A current live/indefinite stream has no full-history continue action, even
   when the finite-replay setting is unlimited.
5. A guarded finite replay has no active Gistlate overlay or Store subtitle.
   YouTube native captions are visible and `GL` remains inactive.
6. A force-retranslation decline retains the already displayed completed
   translation; it must not downgrade an active artifact to native captions.
7. No preflight CNY value or numeric request estimate is shown. Provider usage
   returned after real calls remains the authoritative cost record.
8. Existing cache keys, artifact schemas, complete-only persistence, usage
   accounting and one-IIFE userscript output remain compatible.

## 3. Settings contract

Keep the setting with the existing translation strategy:

```ts
export type AutoTranslateLimitMinutes = 15 | 30 | 45 | 60 | 90 | 120 | null

export interface TranslationSettings {
  mode: TranslationMode
  batchSize: number
  /** `null` means unlimited finite replays; live remains guarded. */
  autoTranslateLimitMinutes: AutoTranslateLimitMinutes
}
```

`DEFAULTS.translation.autoTranslateLimitMinutes` is `45`. Normalization accepts
only the six discrete numbers or `null`; a missing, non-finite or otherwise
malformed value migrates to 45. Do not clamp arbitrary values into the nearest
choice because that would silently change the selected policy.

The settings panel adds one select below the translation strategy:

```text
自动完整翻译的字幕跨度上限
15 / 30 / 45（默认）/ 60 / 90 / 120 分钟 / 不限制有限回放
```

The hint states that direct target subtitles and completed cache hits are not
limited, and current live streams remain protected. Saving settings does not
restart a guarded video; the user clicks `GL` again.

## 4. Caption scale and guard classification

Create a pure owner such as `src/core/long-video-guard.ts` for metrics and
policy. It must not read DOM, settings storage, caches or network state.

```ts
export interface CaptionScale {
  spanMs: number | null
  cueCount: number
  sourceCodePoints: number
  playerDurationMs?: number
}

export type GuardEvaluation =
  | { action: 'allow'; scale: CaptionScale }
  | { action: 'guard'; reason: 'long-finite' | 'current-live'; scale: CaptionScale }
```

For cleaned cues:

```text
caption start = minimum finite non-negative cue.s
caption end   = maximum finite cue.s + max(0, cue.d)
caption span  = max(0, caption end - caption start)
source chars  = sum of Unicode code points in each cleaned cue.o
```

Do not add synthetic separator characters to the displayed source count. Use a
finite player duration only when no usable caption span can be derived; do not
take `max(captionSpan, videoDuration)`, because long silent sections do not add
translation input. Player duration may still be displayed/diagnosed as
corroborating metadata.

Classification order:

1. Strong current-live/indefinite playback evidence -> `current-live`.
2. Finite replay with `limit === null` -> allow.
3. Effective span strictly greater than `limit * 60_000` -> `long-finite`.
4. Otherwise -> allow. A span exactly equal to the limit is allowed.

The pure helper receives the current-live boolean from the YouTube adapter; it
does not infer live state from caption length.

## 5. YouTube playback facts

Extend `src/youtube.ts` with a small read-only adapter, for example:

```ts
export interface PlaybackFacts {
  currentLive: boolean
  durationMs?: number
}

export function getPlaybackFacts(expectedVideoId: string): PlaybackFacts
```

Accept player-response metadata only when its video ID matches the Watch URL,
as caption inventory already does. Strong current-live signals are:

- matching `liveBroadcastDetails.isLiveNow === true`;
- a matching current-live player flag when available;
- the native video having `duration === Infinity`;
- live-streamability without an end timestamp when the response marks current
  live playback.

An `endTimestamp` plus finite playback is a replay. `isLiveContent` by itself is
not enough because it remains true for some ended replays. A temporarily `NaN`
or zero duration without another live signal is not enough to classify an
ordinary finite caption source as live. DOM live badges may be used only as a
soft same-player fallback, not as the sole owner of the policy.

Re-read these facts at every fresh-miss preflight. Thus a stream that ends while
the page remains open can become a finite replay on the next `GL` attempt.

## 6. Qualitative request risk

The confirmation shows exact known scale and a deliberately qualitative label.
Keep the label logic pure and tested. A conservative initial score is:

```text
strategy base: whole=0, batch=1, sentence=2
large source:  +1 when chars >= 50,000 or cues >= 1,000
very large:    +2 instead when chars >= 120,000 or cues >= 3,000
result:        0=low, 1=medium, >=2=high
```

The UI explains the dominant reason (strategy and/or source scale) without
claiming a request count, token count or monetary bound. These bands are a UX
warning, not pricing logic; they must never enter the usage ledger or artifact
cost calculation.

## 7. Resolve preflight boundary

Extend `ResolveOptions` with an asynchronous fresh-translation hook and make the
return type an explicit union:

```ts
export type TranslationPreflightDecision =
  | { action: 'continue' }
  | {
      action: 'skip'
      reason: 'long-video' | 'current-live' | 'user-declined' | 'settings-opened'
    }

export type ResolveResult =
  | { status: 'ready'; cues: Cue[]; source: Source; artifact: CacheEntry }
  | { status: 'skipped'; reason: TranslationPreflightDecision['reason'] }

export interface ResolveOptions {
  // existing options...
  beforeFreshTranslation?: () => Promise<TranslationPreflightDecision>
}
```

Exact ordering inside `resolveTranslation`:

```text
normalize settings / cache key / source fingerprint
  -> L1 compatibility lookup (unless force)
  -> L2 compatibility lookup (unless force)
  -> await beforeFreshTranslation
       skip -> typed skipped result
       continue -> proceed
  -> onTranslating
  -> load provider secrets
  -> beginUsageOperation
  -> translate / measure usage / complete-only L1+L2 persistence
```

The hook is also invoked in `force` mode after the intentional cache-read skip.
An aborted signal is checked before and after awaiting the hook. A skip is not an
exception and must not pass through the translation failure UI or ledger.

Tests at this boundary are the principal cost-safety proof: cache hits never
invoke the hook, while every skipped cache miss/force attempt invokes zero
translation, usage and cache-write calls.

## 8. Activation and guarded state

Separate activation intent from force behavior:

```ts
type ActivationIntent = 'automatic' | 'manual' | 'force-retranslation'

interface GuardedVideoState {
  videoId: string
  reason: 'long-finite' | 'current-live'
  scale: CaptionScale
}
```

`GuardedVideoState` is memory-only and contains no authorization. Add its video
ID to the pure auto-start suppression policy so repeated YouTube events cannot
restart the same guarded video. Navigation clears it.

Preflight behavior by intent:

| Intent / classification | Decision |
|---|---|
| automatic + ordinary | continue immediately |
| automatic + long finite | skip and enter guarded state |
| automatic + current live | skip and enter live-guarded state |
| manual + ordinary | continue immediately |
| manual + long finite | show detailed confirmation; continue only on explicit action |
| manual + current live | show information-only dialog; skip |
| force + ordinary | retain existing force confirmation |
| force + long finite | use one detailed long-video/overwrite confirmation, not two dialogs |
| force + current live | information only; retain existing completed display |

Entering a guarded state after a fresh activation must:

1. reset Store/abort state after the resolver has returned the typed skip;
2. remove the Gistlate overlay and its native-caption hiding class;
3. clear `currentTrack`, `activeVideoId` and progress/translating state;
4. retain only the small `GuardedVideoState` needed for suppression/tooltip;
5. leave `GL` inactive and show the appropriate bounded status.

Caption acquisition already calls `ensureCaptions()`. Destroying the overlay
therefore reveals YouTube's currently selected native subtitle track; the guard
must not programmatically choose a different language.

Clicking `GL` on a guarded video starts normal manual activation again rather
than trusting stale captured cues. This deliberately re-acquires the canonical
track, rechecks target-language/direct display and L1/L2, and re-reads live
facts. Only a still-genuine fresh miss reaches confirmation. It also makes a
target-language or strategy change saved from the settings dialog take effect.

Cancel/settings/live skip during a new activation re-enters guarded native
display. Cancel/settings/live skip during force retranslation keeps the already
active completed Store/overlay unchanged.

If a manually confirmed new long-video provider operation later fails, return
to the same guarded/native state after showing the failure status. This makes
the next `GL` click a one-step, newly confirmed retry. A force operation failure
continues to preserve the old completed Store/overlay.

## 9. Player status and control behavior

Extend `src/ui/status.ts` with non-error guarded messages:

```text
字幕跨度 2 小时 18 分钟，已跳过自动翻译
点击 GL 可手动翻译整个视频
```

The finite-auto notice auto-hides after 8,000 ms. The automatic live notice uses
the same bounded treatment and says to retry after the live stream ends.

Extend the player-button options with an inactive-title override or a small
typed visual state. While the current video is guarded, the inactive title is:

```text
长视频保护：点击手动翻译
```

For a live guard an equivalent title may say to retry after live ends. Active
styling/`aria-pressed` stays false. Navigation restores the existing ordinary
title.

## 10. Confirmation UI

Add a Trusted-Types-safe module such as
`src/ui/translation-guard-dialog.ts`. Construct every node with
`createElement`, `textContent` and event listeners; do not use `innerHTML` or a
runtime template loader.

Finite long-replay dialog content:

- video title when available;
- exact caption span, cue count and source code-point count;
- current sentence/batch/whole strategy (and batch size when relevant);
- qualitative low/medium/high request risk and its non-monetary explanation;
- warning that it translates the entire video and that provider responses
  already returned before page closure may be billable;
- no CNY estimate and no expected request-count number/range.

Actions:

1. `取消` — default/focus-safe action;
2. `打开翻译设置` — close this dialog, open the existing settings panel and
   return a `settings-opened` skip; saving does not auto-retry;
3. `按当前模式翻译整个视频` — explicit one-operation continue.

Escape/backdrop closes as cancel. Enter must not accidentally trigger the
expensive action. Accept an AbortSignal or expose destroy cleanup so SPA
navigation settles the pending decision as skip without a provider request.

The current-live dialog uses the same visual system but offers only close and
states that full translation becomes available after the live stream ends. It
does not expose a continue control.

## 11. Menu and retranslation integration

Keep the existing Tampermonkey `Gistlate 重新翻译当前视频` command as the
fallback rather than adding another permanent player control.

- When the current video is guarded/inactive, route the menu command through
  normal manual activation, so direct tracks and newly appeared cache entries
  are still free and prompt-free.
- When a completed track is active, force retranslation continues to ignore
  cache reads. Ordinary short videos use the existing confirmation; finite long
  videos use the detailed dialog; current live streams have no continue action.
- A confirmed force attempt preserves the existing translated Store during
  progress and replaces it only after complete success, as today.

## 12. Navigation, concurrency and cleanup

- Only one activation/translation/dialog may own the current video at a time.
  Existing `translatingVideoId` plus dialog idempotence prevents duplicate
  confirms and operations.
- SPA navigation aborts acquisition/resolve, closes the guard dialog, clears the
  guarded state/status/button title, restores native captions and discards the
  old video's observed timedtext state.
- A user click while confirmation is open is ignored rather than opening a
  second dialog.
- A cancelled preflight does not log `Translation failed` and does not show the
  red failure status.
- Settings changes do not mutate an in-flight confirmed operation. They apply
  only when a later activation/preflight loads settings again.

## 13. Compatibility and rollout

- Settings migration is additive and defaults all existing users to 45 minutes.
- L1/L2 artifact data and GitHub pool paths do not change.
- Usage DB schema does not change because guarded attempts create no operation.
- Direct-target, L1 and L2 paths preserve their current UI and cost behavior.
- No tokenizer or external pricing dependency is added to the userscript.
- The build must remain one static IIFE with zero SystemJS, dynamic import and
  unsafe HTML sinks.

Rollback is local: removing the new preflight hook and UI state restores the old
flow; stored settings tolerate an ignored additive field. No remote artifact or
database migration must be reversed.

## 14. Verification matrix

| Scenario | Expected result |
|---|---|
| 44:59 finite fresh miss, default setting | translate normally |
| exactly 45:00 finite fresh miss | translate normally |
| 45:00.001 finite fresh miss | auto guard; zero usage/provider/write |
| 3-hour finite with compatible L1/L2 | display cache; no guard/prompt |
| 3-hour target-language track | display direct; no guard/prompt |
| 3-hour finite, `unlimited` | auto translate on fresh miss |
| current live, `unlimited` | guard; no automatic/manual full translation |
| guarded finite -> GL -> cancel/settings | native subtitles; zero operation |
| guarded finite -> GL -> confirm | one existing full-video operation |
| confirmed operation fails -> GL retry | confirmation required again |
| long completed artifact -> force -> cancel | keep old translated overlay |
| live ends without URL change -> GL | reacquire/recheck as finite replay |
| navigation while dialog open | close/skip; no provider or artifact |
