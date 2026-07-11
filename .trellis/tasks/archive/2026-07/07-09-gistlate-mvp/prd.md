# Gistlate MVP: YouTube subtitle LLM translation with GitHub repo reuse

## Goal

A **userscript** (Tampermonkey / Violentmonkey, Chrome-first) that overlays
**bilingual subtitles** on YouTube videos. Translations are produced by a
user-configured **OpenAI-compatible LLM API** and cached in two tiers so that any
given video is translated **at most once** across a small circle of users:

- **L1** — local IndexedDB (per-device, instant).
- **L2** — a **public GitHub repository** ("the pool repo"). Reads are tokenless
  via `raw.githubusercontent.com`; writes are direct commits via the GitHub
  Contents API using the user's PAT.

Delivery vehicle = **userscript**, chosen over a Chrome extension because
`GM_xmlhttpRequest` bypasses CORS for arbitrary OpenAI/GitHub hosts and the whole
thing collapses into a single script (no service worker, no MAIN/ISOLATED split,
no host-permission juggling). Audience is a technical circle that can install
Tampermonkey trivially.

Name = **Gist**(repo) + trans**late**.

## Context / Prior Art

- Reference project: `rxliuli/bilingualtube` (WXT + TS, **GPL-3.0**). We reuse its
  *ideas* (timedtext interception, numbered-line batch translation, overlay
  rendering) via **clean-room reimplementation**. Do **not** copy its source —
  Gistlate ships under its own license.

## Users & Reuse Model

- **Pool owner (primary user):** configures one pool repo they have write access
  to. The extension reads from and directly commits to that repo.
- **External contributors:** fork the pool repo on GitHub, run their own instance
  (pointed at their fork), and open PRs to the upstream owner **manually via the
  GitHub web flow**. The extension does **not** automate fork/PR in the MVP.
- Consequence: the extension is identity-agnostic — it always reads/writes the
  single repo named in settings. The fork+PR collaboration is an external social
  layer.

## Requirements

### R1 — Subtitle acquisition
- Intercept YouTube's own `https://www.youtube.com/api/timedtext` request by
  hooking `unsafeWindow.fetch` / `XMLHttpRequest` at `document-start`, and read the
  full caption track from the cloned response. Do not re-request timedtext from
  scratch (avoids YouTube signing/pot restrictions).
- Support manual captions and auto-generated (ASR) captions. ASR punctuation is
  handled by the LLM during translation (no local ML models in MVP).
- Handle YouTube auto-translated tracks (`tlang`) by preferring the original track.
- Reset all per-video state on SPA navigation between videos.

### R2 — Translation (OpenAI-compatible)
- Configurable `baseUrl`, `apiKey`, `model`, target language, and a customizable
  prompt template.
- **Eager whole-video translation**: on a confirmed cache miss, translate the
  entire track (batched, concurrent, with retry), not just the playhead.
- Batch cues as numbered lines (`[1] …`), parse numbered output, validate that
  the returned line count matches the input, retry on mismatch.
- Support both `/chat/completions` and `/responses` endpoints.

### R3 — Two-tier reuse cache
- Cache key: `videoId | srcLang | tgtLang`. Model + prompt version are stored as
  **metadata only** (not part of the key), so a differently-modeled translation is
  still reused.
- Lookup order on video load: **L1 → L2 → translate**. First hit wins; a hit
  **skips the LLM entirely**.
- **Write timing (locked):** only after L2 is confirmed to have no entry AND the
  full-video local translation completes with **100% success**, write once:
  first to L1, then a single commit to L2. Never upload partial results.

### R4 — GitHub pool repo (L2)
- Pool repo must be **public**. Settings: `owner`, `repo`, `branch` (default
  `main`), plus PAT (classic, `public_repo` scope) for writes.
- **Read:** `GET https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`;
  404 ⇒ miss (tokenless).
- **Write:** `PUT /repos/{owner}/{repo}/contents/{path}` (base64 body, commit
  message; include `sha` when overwriting).
- Path convention (sharded): `data/{videoId[0:2]}/{videoId}.{src}-{tgt}.json`.
- Stored artifact is a compact JSON (see design.md §Data Model).
- A **canonical pool repo scaffold** (README, JSON schema, `data/` layout, PR
  template, CI validating schema + rejecting malformed/dup entries) is a
  deliverable so external PRs stay consistent.

### R5 — Bilingual rendering
- Overlay original + translated lines on `#movie_player`; hide native captions;
  mirror native caption position/size where practical.
- Display modes: `bilingual` (default) and `translation-only`.

### R6 — Configuration & secrets
- In-page **settings panel** (vanilla DOM modal) opened via
  `GM_registerMenuCommand` ("Gistlate 设置"): OpenAI settings, target language,
  display mode, pool repo, PAT. "Test connection" for both OpenAI and GitHub.
- All settings + secrets persisted via `GM_setValue`/`GM_getValue` (Tampermonkey
  local storage, not synced unless the user enables TM cloud sync). Secret keys
  are namespaced (`secret.*`) and never logged.

## Constraints

- Userscript targeting Tampermonkey (primary) + Violentmonkey; built with
  **`vite-plugin-monkey`** (TS + ES modules → single `.user.js`). No React.
- Runs on `https://www.youtube.com/*` at `document-start`.
- Cross-origin calls to the OpenAI baseURL and GitHub go through
  **`GM_xmlhttpRequest`** (bypasses page CORS). `@connect` must list
  `api.github.com`, `raw.githubusercontent.com`, and `*` (arbitrary OpenAI hosts);
  Tampermonkey prompts once to allow `*`.
- `@grant` is auto-collected by vite-plugin-monkey from imported GM APIs.
- Interception requires the user to enable captions (CC) at least once; the script
  may guide/programmatically toggle captions.
- `raw.githubusercontent.com` has ~5 min CDN staleness; the writer's own fresh
  entries are covered by L1, so this is acceptable.
- Clean-room from bilingualtube (GPL-3.0); Gistlate ships under its own license.
- Distribution/update via `.user.js` (Greasyfork or the pool repo's raw URL) with
  `@downloadURL`/`@updateURL` + a small `.meta.js`.

## Acceptance Criteria

- [ ] On a YouTube video with captions, a bilingual overlay appears (original +
      translated) and native captions are hidden.
- [ ] **Cache miss path:** with empty L1 and no L2 entry, the whole track is
      translated via the configured OpenAI-compatible API and the overlay shows
      translations as the video plays.
- [ ] **Write-on-success:** after a successful full-video translation, exactly one
      JSON artifact appears in the pool repo at
      `data/{shard}/{videoId}.{src}-{tgt}.json`, matching the schema; a failed or
      aborted translation writes **nothing** to L2.
- [ ] **L2 reuse:** on a second device / fresh profile pointed at the same repo,
      loading the same video populates the overlay with **zero** LLM API calls
      (verified: no request to the OpenAI baseURL).
- [ ] **L1 reuse:** reloading the same video on the same device is instant with no
      network translation call.
- [ ] SPA navigation to a different video resets state and translates the new
      video correctly (no stale cues).
- [ ] Settings panel (via GM menu command) persists settings across reloads; both
      "Test connection" buttons work; secrets are stored via `GM_setValue` under
      `secret.*` keys and never appear in logs.
- [ ] Canonical pool-repo scaffold exists with README, schema, PR template, and a
      passing CI validation on a sample entry.

## Out of Scope (MVP)

- Local ONNX/ML punctuation restoration (LLM handles punctuation).
- In-extension fork/PR automation for external contributors.
- Fine-grained PAT flow; OAuth device flow.
- Multi-source reads (upstream + multiple forks) and community-scale indexing.
- Microsoft/Google translation engines (OpenAI-compatible only for MVP).
- Live-stream captions.
- Packaging as a native Chrome extension (userscript only for MVP; the
  framework-agnostic core keeps this option open later).

## Open Questions (deferred, non-blocking)

- Canonical pool repo identity (owner/name) — placeholder + configurable for MVP.
- Re-translate/overwrite UX ("force refresh a bad translation") — post-MVP.
