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

## Subtitle sentence reconstruction (alignment is sacred)

Translating auto-caption fragments as complete sentences must keep the translation
aligned to the correct time. Two hard-won rules:

- **Never do one-pass "segment + translate + report fragment ranges".** Asking the
  LLM to translate AND report which fragments each sentence covers makes the
  reported ranges drift out of sync with the translations — structurally valid
  coverage, but the translation shows over the WRONG fragments' time. Symptom: each
  cue's `t` belongs to a later cue's `o`.
- **Group first, translate second (two-pass), so alignment is guaranteed by
  construction.** Pass 1: per-fragment boundary flags (`[n] E`/`C`, 1:1, validated —
  every fragment present). Group deterministically into contiguous ranges. Pass 2:
  translate the joined sentence texts with the proven numbered 1:1 translator. Each
  sentence-cue's `o`, `t`, and time then all derive from the SAME fragment range —
  an imperfect boundary only shifts a seam, it can never mis-time a translation.
- **Clamp each sentence-cue's end to the NEXT sentence's start.** ASR fragment
  durations are estimated and frequently overlap (a later fragment starts before the
  previous one's reported end). `end_i = frags[next.start].s` (last sentence uses raw
  end), `d = max(1, end - s)` → gap-free, non-overlapping sequential display; keeps
  `findCueAt`'s binary search valid.
- **Strip non-speech annotations before segmentation** (`[...]`/`【...】` inline or
  standalone, `♪` keeping inner lyrics), replacing with `''` (not a space) so CJK
  mid-word joins cleanly; drop pure-annotation cues. They corrupt both segmentation
  and translation otherwise.
- On any non-abort failure, **fall back to 1:1 fragment translation** (never worse
  than aligned fragments); on abort, throw without writing.

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
- Pipeline: capped ranges become pass-2 units; context is absent from pass 1 and
  present in pass 2; timing derives from the same ranges.
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
