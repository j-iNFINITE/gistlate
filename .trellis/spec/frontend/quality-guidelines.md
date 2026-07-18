# Quality Guidelines

## GM API Usage

All cross-origin HTTP calls use `gmFetch()` (`src/net/gm.ts`), a Promise wrapper
over `GM_xmlhttpRequest`. Never use `window.fetch` for external calls — it will hit
CORS errors in the userscript context.

```ts
import { gmFetch } from '../net/gm'

const r = await gmFetch({ method: 'GET', url: '...', headers: {...}, signal })
// r = { status: number, text: string }
```

### @grant auto-collection

vite-plugin-monkey auto-collects `@grant` from GM API imports. Import from `$`:
```ts
import { GM_xmlhttpRequest, GM_setValue, unsafeWindow } from '$'
```

## Error Handling Patterns

### Translation pipeline (fail-closed)
- Any batch failure after retries → throw → no partial L2 write
- Caller shows original-only (no translation) rather than corrupted output

### L2 write (soft-fail)
- L2 GitHub write errors are caught and logged, never thrown
- L1 cache is written before L2, so even a failed L2 write preserves the translation

### Secrets
- API keys and PATs stored under `secret.*` GM keys (`secret.openaiKey`, `secret.githubPat`)
- Loaded only at call sites via `loadSecrets()`, never logged
- Never sent to console, Sentry, or any third party

## Test Patterns

### Mocking gmFetch
```ts
vi.mock('../net/gm', () => ({ gmFetch: vi.fn() }))
// Verify calls:
expect(mockGmFetch).toHaveBeenCalledWith(expect.objectContaining({
  method: 'POST',
  url: expect.stringContaining('/chat/completions'),
}))
```

### Numbered output parsing
Test `parseNumbered()` with happy path, missing slots, extra whitespace, and
reordered output. All parsing failures must throw.

## Forbidden Patterns

- ❌ Calling `unsafeWindow.fetch` for our own outbound requests — use `gmFetch`
- ❌ Storing API keys or PATs in `storage.sync` or GM settings key (use `secret.*`)
- ❌ Partial L2 writes on failed translation
- ❌ Leaving overlay DOM or injected styles after SPA navigation

## Trusted Types & the single-file build (hard rule)

YouTube enforces `require-trusted-types-for 'script'`. This blocks, with an
uncaught error, ALL of: `innerHTML`/`outerHTML`/`insertAdjacentHTML` (TrustedHTML),
`script.src = url` and SystemJS chunk loading (TrustedScriptURL), and `eval` /
`new Function` (TrustedScript).

Consequences for this project:
- **Never use dynamic `import()`** in `src/`. It makes vite-plugin-monkey emit a
  SystemJS loader (`@require systemjs` + `System.register`) that sets `script.src`
  → blocked on YouTube → the whole userscript fails to load. Keep everything
  statically imported so the build stays a single IIFE. Verify after building:
  `dist/gistlate.user.js` body starts with `(function () {` and
  `grep -c "systemjs\|System.register"` is `0`.
- **Build DOM with `createElement` + `textContent`/`createTextNode`**, never
  `innerHTML`. (Applies to overlay, panels, buttons, status pill.)
- Userscript dev servers (`pnpm dev`) load code dynamically and are likely
  CSP-blocked on YouTube; use `pnpm build:watch` + a local-file install instead.

## DOM injection into YouTube's player

- `insertBefore(newNode, ref)` requires `ref` to be a **direct child** of the
  parent, or it throws `NotFoundError`. `.ytp-settings-button` found via
  `controls.querySelector(...)` is not always a direct child of
  `.ytp-right-controls`. Insert relative to the ref's own parent
  (`ref.parentElement.insertBefore(node, ref)`), and wrap player-DOM injection in
  `try/catch` with a fallback so a DOM surprise never throws every poll tick.
- Injected controls must be **idempotent + re-injectable** (YouTube rebuilds its
  controls on SPA navigation); a 1s poll re-adds them if missing.

## Testing: mock time in retry/backoff tests

Translation retries use real `setTimeout` backoff (1s/2s). In vitest use
`vi.useFakeTimers()` (real timers in `afterEach`) and drive pending timers with
`await vi.runAllTimersAsync()`. Keeps the suite <1s instead of ~14s. Microtasks
are not faked, so mocked `gmFetch` promises still resolve.

## Scenario: semantic-aligned progressive translation

### 1. Scope / Trigger

Use this contract whenever auto-caption fragments are grouped, display ranges
are shortened, translation requests are batched, or partial results are shown.
It prevents the `vvLnNHtY09U` failure where structurally valid target lines were
one semantic cue ahead because display-capped partial clauses were translated as
independent numbered items, and the `Ru7H092hFAI` failure where Google word
timings were discarded before boundary detection and canonical responses could
copy Japanese while still passing the ID parser.

### 2. Signatures

```ts
type TranslationMode = 'sentence' | 'batch' | 'whole'

interface Cue {
  s: number
  d: number
  o: string
  t?: string
  sentenceEnd?: boolean // internal source hint; omitted from final artifact cues
}

interface SentencePlan {
  id: string                    // global S001...
  sourceRange: SentenceRange    // complete translation owner
  sourceText: string
  displayRanges: SentenceRange[]
  displayTexts: string[]
}

interface TranslationProgress {
  stage: 'boundaries' | 'translating' | 'aligning'
  completedSentences: number
  totalSentences: number
  cues: Cue[]                   // memory-only until full success
}

translateCues(cues, target, config, key, options):
  Promise<{ cues: Cue[]; diagnostics: PipelineDiagnostics }>

interface PipelineDiagnostics {
  boundaryMethod: 'manual-cues' | 'timed-punctuation' | 'llm'
  boundaryRequestCount: number
  translationRequestCount: number
  alignmentRequestCount: number
  fallbackSentenceCount: number
}

interface TranslationPipelineOptions {
  sourceKind?: 'manual' | 'asr'
}

// IndexedDB `gistlate-usage`, version 1
operations: { keyPath: 'operationId'; indexes: videoId, endedAt, status }
totals:     { keyPath: 'videoId' }

beginUsageOperation(input): Promise<UsageOperation>
appendUsageResponse(operationId, stage, usage?): Promise<void>
finalizeUsageOperation(operationId, status): Promise<UsageOperation | undefined>
```

Provider usage is decoded once at the HTTP boundary and propagated as
`onUsage(stage, RequestUsage | undefined)` before content validation.

### 3. Contracts

- Track kind is explicit once the canonical YouTube track is selected. A
  `manual` track treats every visible YouTube cue as one complete translation
  owner, skips boundary analysis, and records `manual-cues` with zero boundary
  requests. Do not reinterpret incidental manual `tOffsetMs` as ASR.
- When a clear majority of Google ASR segments carry `tOffsetMs`, recover
  absolute segment time, split after sentence punctuation, attach a leading
  next-event sentence mark to the preceding fragment, and set `sentenceEnd` on
  every source Cue. Preserve the cleaned source exactly. Sparse/untimed ASR
  tracks stay on the legacy event parser.
- If every source Cue has `sentenceEnd`, use it locally and record
  `timed-punctuation` with zero boundary requests. Otherwise boundary output
  contains every fragment exactly once as `E`/`C`; missing/duplicate IDs are
  invalid. Official DeepSeek uses thinking enabled/high and no sampling controls.
- A complete source sentence is the minimum translation owner. Display capping
  creates nested ranges only; it must never create translation request items.
- Reject a likely false complete sentence before translation when it exceeds 30
  seconds, 240 source code points, or three terminal sentence marks.
- Canonical responses use stable global IDs and contain exactly the requested
  non-empty ID set. Then reject source echo/prefix, kana-heavy zh-Hans,
  Traditional-only zh-Hans characters, and severe long-source omission. Retry
  with only a compact correction at the changing tail; do not cache a rejected
  canonical target. Requests keep the same whole-video reference prefix.
- Translation/alignment use official DeepSeek thinking disabled,
  `temperature: 0`, and no `top_p`.
- Multi-range sentences run a separate alignment request returning `K-1`
  strictly increasing Unicode code-point cuts. Local slices must concatenate
  character-for-character to the immutable canonical target. Reject cuts inside
  Latin/ASCII product tokens, between adjacent Han characters, or immediately
  before closing punctuation.
- Preflight the number of structurally safe target positions. If fewer than
  `K-1` exist, skip the alignment API and use the complete-sentence fallback;
  this preflight may reject impossible work but must never choose semantic cuts.
- After three invalid alignments, emit one full-source/full-target long cue.
  Never guess proportional cuts and never translate fragments independently.
- Clamp every cue to the next emitted range start and the shared 1.2s gap
  tolerance so output stays sorted/non-overlapping for binary search.
- Fresh progress is Store-only; force progress is status-only. L1/L2 persist
  exactly one fully validated artifact.
- `gistlate-usage` is independent of the subtitle cache. Count every HTTP 200,
  including parse-invalid retries; reasoning tokens are already part of
  completion tokens and are not charged again.
- Write the running operation before the first API call and update it after each
  response. Keep exact per-video lifetime totals, newest 20 details per video,
  and at most 2,000 details globally; pruning details never subtracts totals.
- A successful artifact stores the producing operation's usage, strict official
  DeepSeek price snapshot, and CNY cost. Failed/aborted operations remain local.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Usable Google word offsets | Recover timed fragments/hints locally; exact source preservation |
| Explicit manual track | One complete owner per YouTube cue; `manual-cues`; zero boundary calls |
| Complete timed hints | Zero boundary calls; `boundaryThinking: not-used` |
| Boundary missing/duplicate/truncated after retries | Fail operation; no translation artifact |
| One range exceeds 30s/240 code points/3 stops | Reject as a false sentence before display capping |
| Canonical ID missing/duplicate/extra/empty | Retry; split only contiguous multi-sentence groups; single sentence fails closed |
| Canonical source echo/wrong zh-Hans script/severe omission | Retry with correction tail; then split/fail closed |
| Alignment cut wrong count/type/order/range | Retry with compact validation error |
| Alignment cut inside Latin/Han or before closing punctuation | Retry; safe full-sentence fallback after exhaustion |
| Fewer safe positions than required cuts | Immediate full-sentence fallback; zero alignment requests |
| Three alignment attempts invalid | One complete long cue; increment fallback count |
| One independent group permanently fails | Other fresh groups may display; final persistence fails |
| Navigation/user abort | Abort requests, discard persistence, ledger `aborted` |
| Force failure | Keep prior complete Store/cache result visible |
| Provider usage absent/partial | Keep known tokens, mark incomplete, do not fabricate cost |
| Unknown provider/model | Tokens only; no DeepSeek price snapshot or CNY cost |
| Stale `running` ledger row on initialization | Reconcile to `aborted` without inventing usage |
| Subtitle cache clear | Leave `gistlate-usage` totals/details untouched |

### 5. Good / Base / Bad Cases

- **Good:** Google ASR has dense `tOffsetMs` -> recover internal punctuation
  fragments -> joined cleaned source remains identical -> use local boundary
  flags with zero boundary API calls.
- **Good:** manual captions -> keep legacy event cues -> trust each authored cue
  as a complete owner -> translate only; no E/C request or ASR safety-limit
  rejection. A long cue stays intact because no reliable intra-cue timing exists.
- **Base:** untimed ASR -> keep legacy event cues -> use validated DeepSeek E/C
  detection and the normal false-sentence safety limits.
- **Good:** long complete sentence -> one canonical target -> validated code-point
  cuts -> several timed cues whose targets rejoin exactly.
- **Base:** one display range -> validated canonical target becomes that cue; no
  alignment request.
- **Bad:** `capSentenceRanges(...)` output is sent to the translator as separate
  IDs. The model can move the next clause forward while count/timing tests pass.
- **Bad:** event segments are joined while `tOffsetMs` is discarded. Visible
  text tests pass, but internal sentence boundaries become inexpressible.
- **Bad:** canonical ID/count or target reconstruction is treated as semantic
  validation. Japanese source echo and cuts inside `LiberNovo`/`腰痛` can pass
  those structural checks.

### 6. Tests Required

- Plans prove complete and display ranges each cover source fragments exactly.
- Canonical parser rejects missing, duplicate, extra, empty, and prose output.
- Canonical validator covers source echo/prefix, kana-heavy output, Traditional
  output, severe omission, and a valid Simplified-Chinese base case.
- Cut parser covers Unicode supplementary characters, exact reconstruction, and
  unsafe Latin/Han/pre-punctuation cuts.
- Alignment preflight asserts an all-Han target performs zero alignment calls
  and increments the fallback count once.
- Timedtext tests cover internal event stops, a stop at the next event start,
  sparse-offset legacy fallback, missing-offset inference, decimals/punctuation
  runs, exact text, and positive non-overlapping times.
- Manual-track tests prove incidental offsets stay on the legacy parser, every
  cue is one owner, and boundary usage/request count remains zero.
- Sentence/batch/whole grouping changes request grouping only, not ownership.
- Scheduler tests current-playhead warm-up, live dequeue reprioritization,
  out-of-order completion, group progress, failure, and abort.
- Usage tests count parse-invalid HTTP 200 retries before format validation and
  verify no reasoning-token double charge.
- Ledger integration tests cover running/success/fail/abort, stale reconciliation,
  exact lifetime totals, 20/2,000 pruning, and subtitle-cache independence.
- Regression fixture checks `vvLnNHtY09U` anchors at 17.720–32.559s: Gundam
  Marker/viewers and prior-method/partial-painting remain source-owned.
- A replay of the real `Ru7H092hFAI` JSON3 must preserve all 5,618 source
  characters and produce no complete sentence over 30 seconds.
- Build remains one static-import IIFE with no SystemJS/dynamic import.

### 7. Wrong vs Correct

#### Wrong

```ts
const displayRanges = capSentenceRanges(cues, completeRanges)
const targets = await translate(displayRanges.map(joinSource))
```

```ts
// Lossy adapter: true sentence boundaries inside the event become impossible.
const text = event.segs.map((segment) => segment.utf8).join('')
cues.push({ s: event.tStartMs, d: duration, o: text })
```

#### Correct

```ts
const plans = buildSentencePlans(cues, completeRanges)
const canonical = await translateCompleteSentences(plans)
const cuts = await alignImmutableTargets(plans, canonical)
const finalCues = sliceAndAssembleLocally(plans, canonical, cuts)
```

```ts
// Preserve richer upstream timing internally; final persisted cues still use
// the compact {s,d,o,t} schema.
const sourceCues = parseTimedtextWithOffsets(events)
const flags = sourceCues.every(hasSentenceEnd)
  ? sourceCues.map((cue) => cue.sentenceEnd)
  : await detectBoundaries(sourceCues)
```

Always strip non-speech annotations before this flow (`[...]`/`【...】`, musical
markers) so annotations cannot corrupt boundary detection or translation.

## Scenario: context-aware translation and explicit retranslation

### 1. Scope / Trigger

Use this contract whenever video metadata is added to translation, sentence
ranges are refined for display, or a caller bypasses L1/L2 to regenerate a
shared artifact. It spans the YouTube adapter, prompt transport, segmentation,
cache orchestration, Store lifecycle, and userscript menu.

### 2. Signatures

```ts
interface TranslationContext {
  title?: string
  description?: string
}

interface ResolveOptions {
  signal?: AbortSignal
  onTranslating?: () => void
  force?: boolean
  context?: TranslationContext
  onProgress?: (progress: TranslationProgress) => void
  getCurrentTime?: () => number
}

resolveTranslation(videoId, srcLang, sourceFragments, options?): Promise<{
  cues: Cue[]
  source: 'l1' | 'l2' | 'fresh'
}>

capSentenceRanges(sourceFragments, sentenceRanges): SentenceRange[]
```

### 3. Contracts

- Normalize metadata once through `translate/context.ts`: collapse whitespace,
  omit empty fields, cap title at 300 Unicode code points and description at
  2,000.
- Accept `ytInitialPlayerResponse.videoDetails` only when its `videoId` matches
  the current watch URL; stale SPA metadata must not cross videos.
- Metadata is uploader-controlled, untrusted reference data. JSON-encode it in
  the user prompt and instruct the model to ignore embedded instructions. Send it
  to pass-2 translation/fallback, not pass-1 E/C detection, and add no extra LLM
  analysis request.
- `force: true` skips **reads only** (`getL1`, `readL2`). It reuses the normal
  full-success `translate -> putL1 -> writeL2` path and the same cache key/path.
- Re-check `AbortSignal` after model completion and before each persistence
  boundary. Never cache a result already known to be stale.
- Preserve a separate `CurrentTrack` of cleaned original fragments. Do not feed
  reconstructed Store cues back into pass 1 during retranslation.
- Keep old Store cues visible during retranslation; replace them only after
  `resolveTranslation` succeeds.
- Refine ranges only at existing fragment boundaries. Targets are 15 words for
  space-separated text and 30 visible characters for CJK text. A single
  over-limit fragment remains intact. Natural punctuation/pause boundaries may
  extend a range to 125% of target to avoid an orphan tail.
- Cache identity, IndexedDB version, GitHub path, and `{s,d,o,t}` remain unchanged.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Matching player response | Normalize and include title/description |
| Stale player response | Reject it; use current DOM fallback or empty context |
| No metadata | Translate with the existing numbered prompt contract |
| User cancels retranslation | Zero API and cache calls |
| No captured source track | Inform the user to enable CC; do not translate |
| Same video already translating | Refuse a concurrent force operation |
| Model/parse failure | Throw; do not call `putL1`/`writeL2`; keep Store cues |
| Signal aborted after model return | Throw before persistence |
| L2 overwrite fails | Keep the successful new L1 result (soft-fail policy) |
| Single fragment exceeds display target | Keep it intact; let overlay wrap |

### 5. Good / Base / Bad Cases

- **Good:** cached video + confirmed force action -> skip both reads -> translate
  original fragments with current metadata/settings -> replace L1 -> attempt same
  L2 path -> replace Store cues.
- **Base:** metadata unavailable and `force` false -> ordinary L1/L2/fresh flow;
  numbered translation behavior remains valid.
- **Bad:** clear Store/cache first, then translate reconstructed cues. Failure
  leaves the viewer without the old result and loses reliable fragment alignment.

### 6. Tests Required

- Context normalization: whitespace, empty omission, Unicode-safe caps.
- YouTube metadata: matching player response, stale response with DOM fallback,
  missing description.
- Prompt: JSON context present, absent-context compatibility, injection text kept
  as data, strict numbered output unchanged.
- Segmentation: English/CJK target, natural boundary tolerance, positive pause,
  single over-limit fragment, exact ordered coverage.
- Pipeline: complete ranges remain pass-2 owners; capped ranges are nested
  display timing only; context is absent from pass 1 and present in canonical
  translation/alignment.
- Resolve: normal cache hit, force skips reads, writes only after success, abort
  after model completion still writes nothing.
- Build: single IIFE, no `System.register`/SystemJS, expected GM grants/menu.

### 7. Wrong vs Correct

#### Wrong

```ts
// Store cues may already be sentence-level; clearing first loses the fallback.
store.reset()
await resolveTranslation(videoId, srcLang, store.subtitle!.cues)
```

#### Correct

```ts
// Keep the displayed/cached result until the original fragments fully resolve.
const result = await resolveTranslation(track.videoId, track.srcLang, track.fragments, {
  force: true,
  signal: store.signal,
  context: getVideoContext(track.videoId),
})
store.setSubtitle(track.srcLang, result.cues)
```

## Scenario: canonical YouTube track acquisition, cache safety and player activation

### 1. Scope / Trigger

Use this contract whenever YouTube caption tracks are discovered/fetched,
intercepted timedtext is matched to a track, an artifact is accepted for the
current source, or the player overlay is activated/deactivated. It prevents an
ASR/manual race from choosing different sources and prevents same-text but
differently timed artifacts from recreating subtitle/audio drift.

### 2. Signatures

```ts
type CaptionTrackKind = 'manual' | 'asr'
type TrackPurpose = 'direct-target' | 'translate-manual' | 'translate-asr'

interface CaptionTrack {
  baseUrl: string
  languageCode: string
  kind: CaptionTrackKind
  vssId: string
  name?: string
  selected?: boolean
  audioLanguageMatch?: boolean
}

interface SelectedCaptionTrack {
  videoId: string
  track: CaptionTrack
  purpose: TrackPurpose
}

acquireCurrentSubtitles(videoId, targetLanguage, { signal, onStage }):
  Promise<{ selected: SelectedCaptionTrack; json: GetTimedtextResp; source: 'intercept' | 'direct' }>

interface CacheEntry {
  // existing fields/cues unchanged
  track?: {
    languageCode: string
    kind: CaptionTrackKind
    vssId: string
    sourceFingerprint: string
  }
}

type DisplayMode = 'bilingual' | 'original-only' | 'translation-only'
type SubtitlePosition = { anchor: 'top' | 'bottom'; percent: number }
```

### 3. Contracts

- Select exactly one canonical track before any cache read or translation:
  target-language manual (direct display) → audio-language manual → other
  deterministic manual → audio-language ASR → other ASR. All manual tracks stay
  ahead of ASR unless the manual track is already the no-translation target.
- Runtime identity is `videoId:normalizedLanguage:manual|asr:vssId`. A timedtext
  URL without `vssId` may match by language/kind only when the complete player
  inventory proves that tuple unique. Never use that fallback for ambiguity.
- Keep the observe-only fetch/XHR hook and active request as converging inputs.
  Validate response video ID/track and deliver once; never reconstruct or mutate
  YouTube's original Request.
- Active JSON3 uses `gmFetch` and the selected `baseUrl` with
  `fmt=json3`, `xorb=2`, `xobt=3`, `xovt=3`, `c=WEB`,
  `cplayer=UNIPLAYER`, available device fields and `cver`.
- POT fallback is bounded: matching audio-caption POT → observed same-video POT
  → enable CC once → poll player audio caption data → wait for YouTube's own
  timedtext → retry. External requests have an explicit timeout and AbortSignal.
- A target-language manual track publishes cues directly and creates no LLM
  request, usage operation or translation artifact.
- Keep the canonical pool path unchanged. Before accepting L1/L2, validate both
  normalized source text and source timeline. Partition persisted `cue.o` ranges
  back over current contiguous source fragments and verify starts/derived ends
  within tolerance; same text with different timings is a cache miss.
- `autoStart` defaults true. Player disable is current-video state: abort work,
  clear overlay/status, restore native captions, and suppress only that video's
  automatic restart. The next video follows `autoStart` again.
- Native captions are hidden only while the Gistlate player state is active.
  Overlay root is pointer-transparent; only the high-z drag grip accepts input.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Player response video ID differs from Watch URL | Reject all tracks as stale |
| Target-language manual exists | Direct display; zero provider/cache/ledger calls |
| Manual and ASR both exist | Select approved manual tier before ASR |
| Observed URL omits `vssId`, tuple unique | Allow language/kind match |
| Observed URL omits `vssId`, tuple ambiguous | Do not satisfy canonical session |
| Fast JSON3 returns authorization failure | Enter bounded POT flow |
| 404 or 429 | Terminal acquisition error; no pointless POT retry |
| Invalid/empty JSON3 | Retry only under bounded policy; publish nothing |
| Navigation/player disable | Abort acquisition/translation; no persistence; restore native captions |
| Cached text differs | Cache miss |
| Cached text matches but timeline differs | Cache miss |
| Legacy artifact matches text and derived timeline | Accept without path/schema migration |
| Target translation pending in translation-only mode | Show source fallback with source `lang/dir`, never blank |

### 5. Good / Base / Bad Cases

- **Good:** player inventory selects `ja` ASR; YouTube's own timedtext URL has no
  `vssId` but `ja/asr` is unique and carries POT → accept the observed response,
  preserve word timings, zero boundary calls.
- **Good:** Chinese manual captions exist for target `zh-Hans` → render once using
  target styling and RTL/lang rules as applicable; cost remains zero.
- **Base:** player expando methods are temporarily unavailable → enable CC once,
  wait a bounded interval, select the best staged intercepted candidate.
- **Bad:** process the first response immediately. An early ASR request can abort
  a later higher-quality manual translation and overwrite the canonical pool file.
- **Bad:** accept a cache hit because joined source text matches. A different
  track may carry the same transcript at shifted timestamps.

### 6. Tests Required

- Table-test every canonical selection tier, aliases such as `zh-CN/zh-Hans`,
  selected/unnamed tie-breaks and same-language no-translation behavior.
- Player adapter tests matching/stale video IDs, relative base URLs, audio
  metadata, selection and device/client fields.
- Network-hook tests response pass-through, POT capture before JSON parsing,
  `tlang` exclusion, full identity and unique missing-`vssId` fallback.
- Acquisition tests direct success, intercepted success, 403→matching POT retry,
  terminal status, timeout and abort.
- Cache tests regrouped compatible cues, different text, shifted timeline and an
  old long-gap artifact that violates the 1.2-second cap.
- Settings/render tests legacy migration, three modes, direct target, pending
  fallback language, RTL and top/bottom position calculations.
- Real `Ru7H092hFAI` replay retains 439 fragments, 5,618 source characters,
  complete boolean boundary hints and strictly increasing times.
- Final build remains one IIFE with zero SystemJS/dynamic import/HTML sinks.

### 7. Wrong vs Correct

#### Wrong

```ts
// First network response wins, and cache identity ignores the actual source.
interceptTimedtext(({ json, params }) => {
  resolveTranslation(videoId, params.get('lang')!, parseTimedtext(json))
})
```

#### Correct

```ts
const acquired = await acquireCurrentSubtitles(videoId, settings.tgt, { signal })
const cues = cleanCues(parseTimedtext(acquired.json, {
  kind: acquired.selected.track.kind,
}))

if (!captionTrackNeedsTranslation(acquired.selected, settings.tgt)) {
  store.setSubtitle(acquired.selected.track.languageCode, cues) // no LLM/cache/usage
} else {
  await resolveTranslation(videoId, acquired.selected.track.languageCode, cues, {
    signal,
    track: acquired.selected.track,
  })
}
```

## Scenario: userscript release-line versioning

### 1. Scope / Trigger

Use this contract whenever the userscript minor release line changes, the
GitHub release workflow changes, or a local build is compared with the asset
served through Tampermonkey's `@updateURL`.

### 2. Signatures

```text
package.json.version                  = local/source baseline, e.g. 0.2.0
.github/workflows/release.yml version = 0.2.${github.run_number}
dist/gistlate.user.js @version        = package version visible at build time
release tag/name                      = v0.2.${github.run_number}
```

### 3. Contracts

- A local `pnpm build` uses the committed or working-tree `package.json`
  version. For the 0.2 line it emits `@version 0.2.0`.
- GitHub Actions checks out only committed/pushed `master` content, then
  temporarily runs `npm pkg set version="0.2.${{ github.run_number }}"`. That
  temporary patch is not committed back to the repository.
- The release asset and tag must use the same CI version. Tampermonkey compares
  that emitted `@version` through `releases/latest/download/gistlate.meta.js`.
- A dirty working tree is never part of a GitHub release. `git add` is also
  insufficient; changes must be committed and pushed before Actions can build
  them.
- Advancing the minor line requires changing the source baseline plus every CI
  version/tag occurrence together. Search the old prefix before editing.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Local build before CI | Emit the `package.json` baseline version |
| Push contains committed source changes | Actions builds the pushed `HEAD` |
| Working tree changes are uncommitted | Release excludes them |
| CI release build | Asset `@version`, tag and release name use one `0.2.<run>` value |
| Installed version is higher than a local build | Do not use version alone to claim the local code is newer |
| Minor prefix changed in only one place | Fail review; update package/workflow occurrences together |

### 5. Good / Base / Bad Cases

- **Good:** commit and push the complete feature, CI emits `0.2.<run>`, and the
  release asset contains both the expected version and feature markers.
- **Base:** a local dirty build emits `0.2.0`; it is suitable for explicit local
  testing but is not evidence that GitHub contains those changes.
- **Bad:** observe GitHub `0.1.11` and local `0.1.0`, then assume the higher
  number contains uncommitted local code. CI cannot see the working tree.

### 6. Tests Required

- `pnpm build` and assert the local userscript/meta `@version` equals
  `package.json.version`.
- Inspect the workflow so its build version, tag and release name share the same
  minor prefix and `${{ github.run_number }}`.
- After push, verify the remote meta/user assets share one version and contain a
  marker from the pushed feature (for this release, `gistlate-toggle-btn`).
- Keep the normal one-IIFE/SystemJS/Trusted Types build checks in the same gate.

### 7. Wrong vs Correct

#### Wrong

```powershell
# A push cannot publish uncommitted source changes.
git push origin master
```

#### Correct

```powershell
git add <task-files>
git commit -m "feat: ..."
git push origin master
# Then verify the Actions-built release asset, not only its numeric version.
```
