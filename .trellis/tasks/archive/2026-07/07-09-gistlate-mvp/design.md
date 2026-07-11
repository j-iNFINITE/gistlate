# Gistlate MVP — Technical Design (Userscript)

> Scope: how the pieces in `prd.md` fit together. Delivery = **Tampermonkey
> userscript** built with `vite-plugin-monkey`. Clean-room from bilingualtube.

## 1. Runtime model

**One script**, injected into `https://www.youtube.com/*` at `document-start`.
No service worker, no MAIN/ISOLATED split, no message bus. Everything runs in the
userscript scope; two boundaries matter:

- **`unsafeWindow`** — the real page `window`. Used only to hook the page's
  `fetch`/`XMLHttpRequest` so we can observe YouTube's own `timedtext` responses.
- **`GM_xmlhttpRequest`** — cross-origin transport for **all** our outbound calls
  (OpenAI + GitHub). Bypasses page CORS; our calls never touch page `fetch`, so
  they can't re-enter the interception hook.

GM APIs are imported ESM-style from the `$` alias (vite-plugin-monkey client):
```ts
import { GM_xmlhttpRequest, GM_setValue, GM_getValue, GM_deleteValue,
         GM_registerMenuCommand, unsafeWindow } from '$';
```
`@grant` lines are **auto-collected** by vite-plugin-monkey from these imports.

```
YouTube page (unsafeWindow.fetch/XHR)
        │ observe timedtext (clone, read-only)
        ▼
   [interceptor] ──▶ [store: cues, time, abort]
        │                      ▲
        ▼                      │ translated cues
   [resolve()] ── L1 IndexedDB │
        │        └ L2 GitHub (GM_xmlhttpRequest: raw GET / contents PUT)
        │        └ translate: OpenAI (GM_xmlhttpRequest)
        ▼
   [overlay on #movie_player]         [settings panel via GM menu]
```

## 2. Module layout (vite-plugin-monkey)

```
src/
  main.ts                # entry: install interceptor, mount overlay, register menu
  core/
    resolve.ts           # L1 -> L2 -> translate orchestration (was "background")
    store.ts             # cues/currentTime/AbortController/subscribe
  net/
    gm.ts                # gmFetch(): Promise wrapper over GM_xmlhttpRequest
  intercept/
    netHook.ts           # patch unsafeWindow.fetch + XHR; emit timedtext json
  subtitles/
    timedtext.ts         # GetTimedtextResp types + json -> Cue[]
    cues.ts              # ASR grouping, findCueAt(cues, t)
  translate/
    prompt.ts            # templates + placeholder fill (incl. ASR punctuation)
    openai.ts            # numbered batch translate via gmFetch; parse+retry
    pipeline.ts          # chunk -> concurrency pool -> assemble -> validate
  cache/
    key.ts               # cacheKey(), shard(), repoPath()
    l1.ts                # IndexedDB (idb) per-video store
    l2github.ts          # readL2 (raw GET) / writeL2 (contents PUT) via gmFetch
  ui/
    overlay.ts           # DOM overlay + native caption hide/mirror
    settings-panel.ts    # in-page modal form + test buttons
  settings.ts            # schema, defaults, GM_getValue/GM_setValue (secret.* split)
  youtube.ts             # videoId, yt-navigate-finish, ensureCaptions()
vite.config.ts           # monkey({ entry:'src/main.ts', userscript:{...} })
vite-env.d.ts            # /// <reference types="vite-plugin-monkey/client" />
```

The modular `lib` from the extension plan survives almost verbatim; only the four
entrypoints collapse into `main.ts`, and transport becomes `gmFetch`.

## 3. Data model (unchanged from extension plan)

```ts
interface Cue { s: number; d: number; o: string; t?: string; } // startMs,durMs,orig,translated

interface VideoTranslation {
  v: 1; videoId: string; src: string; tgt: string;
  model: string; promptVersion: number; by?: string; createdAt: string;
  cues: Cue[];
}
```
`createdAt` stamped with `Date.now()` in `resolve()` (allowed at runtime; the
Date.now restriction only applies to Workflow scripts, not shipped code).

### Cache key & repo path
```
key      = `${videoId}|${src}|${tgt}`      // model/prompt NOT in key -> broad reuse
shard    = videoId.slice(0, 2)
repoPath = `data/${shard}/${videoId}.${src}-${tgt}.json`
```

## 4. GM transport (`net/gm.ts`)

```ts
export function gmFetch(opts: {
  method: 'GET'|'PUT'|'POST'; url: string;
  headers?: Record<string,string>; body?: string; signal?: AbortSignal;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const handle = GM_xmlhttpRequest({
      method: opts.method, url: opts.url, headers: opts.headers, data: opts.body,
      onload: r => resolve({ status: r.status, text: r.responseText }),
      onerror: () => reject(new Error('GM_xmlhttpRequest network error')),
      ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
    });
    opts.signal?.addEventListener('abort', () => handle?.abort?.());
  });
}
```
All OpenAI + GitHub I/O goes through this. `@connect` must cover
`api.github.com`, `raw.githubusercontent.com`, `*`.

## 5. Subtitle interception (`intercept/netHook.ts`)

Installed synchronously at top of `main.ts` (document-start):

- Save `const of = unsafeWindow.fetch`. Set `unsafeWindow.fetch = async (...a) => {
  const res = await of(...a); try { if (isTimedtext(url(a))) emit(await
  res.clone().json(), a) } catch {} return res; }`. Always return the untouched
  response so YouTube is unaffected.
- Patch `unsafeWindow.XMLHttpRequest.prototype.open`/`send`: on `readyState===4`
  for a timedtext URL, `JSON.parse(responseText)` → `emit`.
- Re-entrancy: our own calls use `gmFetch` (not page fetch), so no guard needed;
  still keep an idempotency check on `(videoId,lang)`.

Handler (`main.ts`):
1. Parse `lang`,`tlang`,`kind` from URL. If `tlang` present → skip (wait for the
   original-language request).
2. `toCues(json)` (group ASR word-segments; manual captions already line-level).
3. Compute `videoId`, `src=normalize(lang)`, `tgt=settings.tgt`. If `src===tgt`
   (incl. zh-Hans↔zh-Hant → translation-only) → show original, no LLM.
4. `store.reset()` on new video; `store.setCues(cues)`.
5. `await resolve({videoId,src,tgt,cues})` → fill `t` → store updates → overlay.

Firefox note: assigning functions onto `unsafeWindow` may require `exportFunction`
under Greasemonkey; Tampermonkey-on-Chrome (primary target) allows direct
assignment. Flagged for the Violentmonkey/FF pass, not MVP-blocking.

## 6. Translation pipeline (`translate/*`)

Eager whole-track on cache miss (identical policy to the extension plan, transport
swapped to `gmFetch`):
1. `chunk(cues, 40)`; 2. promise pool `concurrency=4`; 3. per batch build numbered
input `[1] …`, POST `/chat/completions` (or `/responses` for OpenAI new models)
via `gmFetch`, `parseNumbered(out,n)`, count-check, retry ≤3 w/ backoff;
4. assemble in order, assert every `t` non-empty; 5. any batch failing after
retries ⇒ throw ⇒ **no L2 write**. Honors `store` `AbortSignal` (SPA nav cancels).

Prompt (`prompt.ts`) instructs: translate to `{{Target Language}}`, **restore
punctuation for unpunctuated ASR runs**, keep proper nouns/HTML, output exactly
`{{Segment Count}}` numbered lines, no meta-text.

## 7. Cache layer

### L1 — `cache/l1.ts` (idb)
IndexedDB under the youtube.com origin. DB `gistlate`, store `videos`, keyPath
`key`. `getL1(key)`, `putL1(key,v)`, optional 30d/N-entry eviction.

### L2 — `cache/l2github.ts` (via gmFetch)
- `readL2(cfg,key)`: `GET https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{repoPath}`;
  200→JSON, 404→undefined, else→throw(log)+treat as miss. Tokenless.
- `writeL2(cfg,artifact)`: `GET /repos/{o}/{r}/contents/{path}` for `sha` (404→none),
  then `PUT` with `{ message, content: base64(json), branch, sha? }` and
  `Authorization: Bearer <PAT>`. base64 via `btoa(unescape(encodeURIComponent(s)))`.

### Orchestration — `core/resolve.ts`
```
if (v=await getL1(key)) return {cues:v.cues, source:'l1'}
if (v=await readL2(cfg,key)) { await putL1(key,v); return {cues:v.cues, source:'l2'} }
const cues = await translateAll(input, settings, signal)      // may throw -> caller shows error, no write
const artifact = stamp(cues, settings)                        // meta + createdAt
await putL1(key, artifact)                                    // L1 first
try { await writeL2(cfg, artifact) } catch(e){ logSoft(e) }   // soft-fail; keep L1
return {cues, source:'fresh'}
```

## 8. Rendering (`ui/overlay.ts` + `core/store.ts`)

- Overlay = two stacked divs appended to `#movie_player`
  (`.gl-original`,`.gl-translated`); native captions hidden via injected
  `GM_addStyle`/`<style>`. `translation-only` hides the original div.
- Playhead: `requestAnimationFrame` reading the `<video>.currentTime`, or the
  player's `timeupdate` → `store.setCurrentTime` → subscriber renders
  `findCueAt(cues,t)`. Mirror native caption size/position when present.

## 9. Settings (`settings.ts` + `ui/settings-panel.ts`)

```ts
interface Settings {
  tgt: string;                                   // default 'zh-Hans'
  displayMode: 'bilingual'|'translation-only';
  openai: { baseUrl: string; model: string };
  github: { owner: string; repo: string; branch: string };
}
// secrets kept under separate GM keys: 'secret.openaiKey', 'secret.githubPat'
```
- `GM_getValue('settings', defaults)` / `GM_setValue('settings', s)`; secrets under
  `secret.*` keys, fetched only at call sites, never logged.
- `GM_registerMenuCommand('Gistlate 设置', openPanel)` mounts an in-page modal
  (vanilla DOM, style-isolated via a container or Shadow DOM) with fields + two
  "Test connection" buttons (`testOpenAI`, `testGitHub` using `gmFetch`).

## 10. Userscript metadata & build

Resulting `.user.js` header (the contract we must produce):
```
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest    (auto)
// @grant        GM_setValue / GM_getValue / GM_registerMenuCommand / unsafeWindow (auto)
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      *
// @downloadURL  <pool-repo raw or Greasyfork>
// @updateURL    <...-.meta.js>
```
`vite.config.ts` (shape; map fields to vite-plugin-monkey's `MonkeyUserScript`
types — verify exact key names against the installed version):
```ts
monkey({
  entry: 'src/main.ts',
  userscript: {
    name: 'Gistlate', namespace: '...',
    match: ['https://www.youtube.com/*'],
    'run-at': 'document-start',
    connect: ['api.github.com','raw.githubusercontent.com','*'],
    updateURL: '...', downloadURL: '...',
  },
  build: { fileName: 'gistlate.user.js', metaFileName: true },
})
```
`vite-env.d.ts`: `/// <reference types="vite-plugin-monkey/client" />`.

## 11. Edge cases & failure handling

- **No captions** → overlay hint to enable CC; no crash.
- **`src===tgt`** → skip LLM (translation-only for zh variants).
- **SPA navigation** (`yt-navigate-finish`) + new timedtext → `store.reset()`
  (aborts in-flight translate).
- **Numbered-output drift** → count-check + retry, then fail-closed (no partial write).
- **GitHub 401/403** → surfaced in settings "Test connection"; at write time soft-log, keep L1.
- **`@connect *` prompt** → Tampermonkey asks once; documented in README.
- **Malformed L2 JSON** → treat as miss, retranslate, overwrite.
- **Artifact >1MB** → guard; Contents API limit; warn (rare for subtitles).

## 12. Canonical pool-repo scaffold (deliverable, unchanged)

`README.md`, `schema/video-translation.schema.json`, `data/` + sample entry,
`.github/PULL_REQUEST_TEMPLATE.md`, `.github/workflows/validate.yml` (schema +
path/filename convention + dup/conflict rejection). Enables clean fork+PR.

## 13. Testing strategy

- **Unit (vitest):** `cues` grouping; `openai.parseNumbered`; `key` path/shard;
  `l2github` URL/sha/base64 builders; settings merge. Mock `gmFetch`.
- **Fixtures:** timedtext JSON (manual/ASR/tlang) → cues.
- **Manual E2E:** acceptance matrix on real videos with a throwaway public repo +
  test OpenAI key; confirm "zero OpenAI calls on L2 hit" via devtools network.

## 14. Out of scope (see prd.md)

ONNX punctuation, fork/PR automation, fine-grained PAT/OAuth, multi-source reads,
MS/Google engines, live captions, native-extension packaging.
