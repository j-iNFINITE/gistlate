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
    sentence-marks.ts    # Shared sentence-mark detection/counting contract
    clean.ts             # Strip non-speech annotations before segmentation
    cues.ts              # findCueAt, getCuesToTranslate helpers
  translate/
    context.ts           # Bounded title/description context contract
    lang.ts              # BCP-47 normalization + language name mapping
    prompt.ts            # Prompt templates + numbered output parser
    openai.ts            # OpenAI-compatible batch translate via gmFetch
    segment.ts           # Boundary ranges, display-length cap, timed Cue assembly
    jobs.ts              # Complete SentencePlan/Job ownership, grouping, cue assembly
    pipeline.ts          # Boundary→canonical translation→cut-only alignment scheduler
    validation.ts        # Canonical target language/echo/completeness quality gate
  usage/
    contracts.ts         # Sole provider-usage decoder + stage/operation aggregation
    pricing.ts           # Strict official DeepSeek V4 CNY pricing snapshots
    ledger.ts            # Separate gistlate-usage IndexedDB totals + bounded operations
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
    style-panel.ts       # Docked WYSIWYG subtitle style editor
    style-button.ts      # Re-injectable player Aa button
    status.ts            # Fresh/retranslation status pill
```

Only `src/main.ts` is the entry. All other modules are imported transitively.

`usage/ledger.ts` intentionally owns a separate IndexedDB database from
`cache/l1.ts`. Subtitle-cache eviction/clearing must never erase lifetime spend.
