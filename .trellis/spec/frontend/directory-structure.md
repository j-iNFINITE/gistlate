# Directory Structure

> Gistlate is a Tampermonkey userscript built with vite-plugin-monkey.
> Single entry point at `src/main.ts`; no page/route splitting.

```
src/
  main.ts                # Entry: install interceptor, mount overlay, register menu
  settings.ts            # GM_getValue/GM_setValue persistence (secrets under secret.* keys)
  youtube.ts             # YouTube-specific helpers (videoId, SPA nav, CC toggle)
  net/
    gm.ts                # gmFetch() — Promise wrapper over GM_xmlhttpRequest
  intercept/
    netHook.ts           # unsafeWindow.fetch + XMLHttpRequest patch (observe-only)
  subtitles/
    timedtext.ts         # YouTube timedtext API types + JSON→Cue[] parser
    cues.ts              # findCueAt, getCuesToTranslate helpers
  translate/
    lang.ts              # BCP-47 normalization + language name mapping
    prompt.ts            # Prompt templates + numbered output parser
    openai.ts            # OpenAI-compatible batch translate via gmFetch
    pipeline.ts          # Chunk→concurrent pool→assemble→validate orchestration
  cache/
    key.ts               # CacheKeyInput type + cacheKey/shard/repoPath helpers
    l1.ts                # IndexedDB per-video cache (idb wrapper)
    l2github.ts          # GitHub repo read (raw.githubusercontent.com) + write (Contents API)
  core/
    store.ts             # Singleton Store: cues, currentTime, abort, subscribe
    resolve.ts           # L1→L2→translate→write orchestration
  ui/
    overlay.ts           # DOM overlay (#movie_player, two stacked divs)
    settings-panel.ts    # In-page modal settings form
```

Only `src/main.ts` is the entry. All other modules are imported transitively.
