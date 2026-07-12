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
