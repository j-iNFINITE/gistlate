# Technical Design — style panel + one-shot translation

> Builds on the shipped userscript. Reuses existing modules; no new deps.
> Prior art / module map: `.trellis/spec/frontend/directory-structure.md`.

## M1 — Live subtitle style customization

### Approach: CSS custom properties + docked live panel

The overlay is restyled by writing **CSS variables** onto the overlay container.
Changing a variable re-renders nothing in JS — the browser repaints instantly.
This is what makes the WYSIWYG panel feel live.

### Data model (extend `settings.ts`)

```ts
export interface SubtitleStyle {
  fontFamily: string      // 'system-sans' | 'serif' | 'mono' | 'yt-noto' | <css font family>
  originalSize: number    // px
  translatedSize: number  // px
  originalColor: string   // #rrggbb
  translatedColor: string // #rrggbb
  fontWeight: 400 | 700
  outline: number         // 0..4 text-shadow strength
  bgOpacity: number       // 0..0.8 background box behind text
  bottomOffset: number    // % from player bottom
  lineGap: number         // px between original & translated
}

export interface Settings {
  // ...existing...
  style: SubtitleStyle
}
```

`DEFAULTS.style` reproduces the current MVP look (originalSize 26, translatedSize
21, colors #fff / #aad6ff, outline shadow, bottomOffset 10, etc.). `mergeDefaults`
gains a `style` branch (backward compatible: missing → defaults).

### Overlay changes (`ui/overlay.ts`)

- Container CSS switches hardcoded values to `var(--gl-*)` with fallbacks:
  ```css
  #gistlate-overlay { bottom: var(--gl-bottom, 10%); }
  #gistlate-overlay .gl-original {
    font-family: var(--gl-font, "YouTube Noto", Roboto, Arial, sans-serif);
    font-size: var(--gl-o-size, 26px);
    color: var(--gl-o-color, #fff);
    font-weight: var(--gl-weight, 400);
    text-shadow: var(--gl-shadow, 2px 2px 4px rgba(0,0,0,.8));
  }
  /* .gl-translated mirrors with --gl-t-size / --gl-t-color; container gap via --gl-gap */
  ```
- New `overlay.applyStyle(style: SubtitleStyle)`: maps the style object → CSS vars
  set on the container element via `element.style.setProperty('--gl-o-size', ...)`.
  Background box = a semi-transparent `background` on the text spans derived from
  `bgOpacity`. `fontFamily` presets map to concrete font stacks.
- `createOverlay()` calls `applyStyle(loadSettings().style)` on mount.

### Style panel (`ui/style-panel.ts`, new)

- **Docked card**, not a full-backdrop modal: `position: fixed`, top-right of the
  viewport (or draggable), `z-index` above player, **narrow** so subtitles remain
  visible. Uses the same DOM-builder helper pattern as `settings-panel.ts` (no
  `innerHTML`).
- Controls = labeled `<input type=range>` (sizes/opacity/offset/outline/gap),
  `<input type=color>` (colors), `<select>` (font family, weight).
- **Live binding:** every control's `input` event → update an in-memory working
  `SubtitleStyle` → call `overlay.applyStyle(working)` immediately. No save needed
  to preview.
- **Sample-cue pinning:** while the panel is open, if `findCueAt` returns nothing,
  the overlay shows a fixed sample line (e.g. original "Sample subtitle text." +
  translated "示例字幕文本。") so there is always a preview target. Implemented as a
  "preview mode" flag on the overlay that short-circuits the empty state.
- **Actions:** Save → `saveSettings({...settings, style: working})`; Reset →
  `applyStyle(DEFAULTS.style)` + set working to defaults; Close → restore the
  saved style (discard unsaved working) and drop preview mode.
- Entry: `GM_registerMenuCommand('Gistlate 字幕样式', openStylePanel)` in `main.ts`
  (alongside the existing settings command). Optional overlay gear button later.

### M1 edge cases
- Panel open with no video/overlay yet → create overlay lazily (existing behavior)
  or show a hint. Panel should no-op gracefully if `#movie_player` absent.
- Closing without saving must revert live changes to the last saved style.

---

## M2 — One-shot whole-transcript translation

### Replace `translate/pipeline.ts` strategy

Current: `translateAllCues` chunks into 40s, runs a concurrency pool, assembles.
New: translate the **whole list in one request**, with an **adaptive recursive
split** only when the model can't return it all.

```ts
// pipeline.ts (rewritten)
export async function translateAllCues(
  cues, targetLang, openaiCfg, apiKey, signal?
): Promise<Cue[]> {
  const texts = cues.map(c => c.o)
  const out = await translateRange(texts, targetLang, openaiCfg, apiKey, signal)
  return cues.map((c, i) => ({ ...c, t: out[i] }))
}

// Recursive: try the whole range; on truncation/mismatch, split and recurse.
async function translateRange(texts, to, cfg, key, signal, depth = 0): Promise<string[]> {
  if (texts.length === 0) return []
  try {
    return await translateBatch(texts, to, cfg, key, signal) // numbered, count-checked, retried
  } catch (e) {
    // Only split when it looks like an output-size problem AND we can still split.
    if (!isSplittable(e) || texts.length <= MIN_SPLIT || depth > MAX_DEPTH) throw e
    const mid = Math.ceil(texts.length / 2)
    const left = await translateRange(texts.slice(0, mid), to, cfg, key, signal, depth + 1)
    const right = await translateRange(texts.slice(mid), to, cfg, key, signal, depth + 1)
    return [...left, ...right]
  }
}
```

- `translateBatch` (existing, in `openai.ts`) already: numbers input, parses
  numbered output, validates count, retries ≤3. Extend it to also surface a
  **truncation** signal: read `finish_reason` from the response; if `'length'`,
  throw a typed `TruncationError`. Count-mismatch after retries throws
  `CountMismatchError`. `isSplittable(e)` = truncation or count-mismatch.
- `MIN_SPLIT` (e.g. 8 lines) and `MAX_DEPTH` (e.g. 6) bound the recursion; below
  the floor a genuine failure propagates (fail-closed).
- **DeepSeek V4 (384K output):** `translateBatch` succeeds on the first call →
  no recursion, exactly one request.
- **Small-output model:** first call truncates → split → each half retried; deep
  enough to fit → completes with all lines.

### Prompt (`translate/prompt.ts`)
- Keep numbered format. Strengthen the system prompt: "These numbered lines are
  consecutive subtitles from a single video. Translate each line to
  {{Target Language}}. Use the whole set as context so terminology, names, tense,
  and tone stay consistent across lines. Output exactly {{Segment Count}} numbered
  lines." (Keep existing rules: no meta-text, keep HTML/proper nouns, add
  punctuation for unpunctuated ASR.)
- Optional (fallback path): when translating a later half, prepend the previous
  half's original+translation as read-only context so the seam stays consistent.
  Cheap on 1M-context models; gated to the split path only.

### `resolve.ts` / `main.ts`
- `resolveTranslation` calls the new `translateAllCues(cues, tgt, cfg, key, signal)`
  (drop the `batchSize`/`concurrency` args). Everything else (L1→L2→translate→
  write-on-success, soft-fail L2) is unchanged.
- Remove now-unused batch/concurrency params throughout.

### Cost / correctness notes
- One-shot sends the system prompt once (cheaper than N batches). Input easily fits
  1M context. Output ≈ input size; only a tiny-output model forces the split path.
- The stored artifact schema is unchanged; `model` still records the engine.

### M2 edge cases
- `src === tgt` short-circuit stays in `main.ts` (no call).
- Empty cues → `[]`.
- Abort mid-request → `translateBatch` sees `signal.aborted` and throws; recursion
  unwinds; no write.
- A model that returns malformed numbering repeatedly at the floor → propagates as
  a failure → original-only display, nothing cached (existing fail-closed UX).

---

## Testing

- **M1 (unit-light, mostly manual):** `applyStyle` maps style→CSS vars (jsdom-ish
  assertion on `setProperty` calls if feasible); settings merge with/without
  `style`. Manual: open panel, drag each control, verify live change, save/reload,
  reset.
- **M2 (unit):** mock `gmFetch`.
  - one-shot happy path → single call, all cues translated.
  - truncation (`finish_reason:'length'`) once → splits into 2 → completes.
  - count-mismatch persists → throws (fail-closed), no partial.
  - abort signal → throws, unwinds.
  - `MIN_SPLIT`/`MAX_DEPTH` floors respected.
- Keep the suite fast: mock the retry backoff timer (also fixes the ~14s slowness
  noted in the MVP).

## Rollout
- Independent milestones; ship M1 and M2 in separate commits. Neither changes the
  stored artifact schema, so no pool migration.
