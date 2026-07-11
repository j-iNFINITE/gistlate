# Gistlate MVP — Implementation Plan (Userscript)

> Ordered, individually-checkable milestones with Definition of Done (DoD) +
> validation. MVP = M0–M6. M7 is post-MVP. Follow `design.md` for contracts.
> Delivery = Tampermonkey userscript via `vite-plugin-monkey`.

## Conventions
- Package manager: `pnpm`. Build: Vite + `vite-plugin-monkey`. Language: TS. No React.
- Validation baseline (after every milestone): `pnpm exec tsc --noEmit` +
  `pnpm build` (emits `dist/gistlate.user.js`) must pass; `pnpm test` (vitest)
  where unit tests exist.
- Dev loop: `pnpm dev` → vite-plugin-monkey serves an install URL; install the
  dev userscript in Tampermonkey once, then it hot-updates.
- Secrets never committed. Manual E2E uses a throwaway public repo + test key.

---

## M0 — Scaffold, GM plumbing, transport
- [ ] `pnpm create vite` (vanilla-ts) or `pnpm dlx tygf`; add `vite-plugin-monkey`.
- [ ] `vite.config.ts`: `monkey({ entry:'src/main.ts', userscript:{ name, namespace,
      match:['https://www.youtube.com/*'], 'run-at':'document-start',
      connect:['api.github.com','raw.githubusercontent.com','*'] },
      build:{ fileName:'gistlate.user.js', metaFileName:true } })`.
- [ ] `vite-env.d.ts`: `/// <reference types="vite-plugin-monkey/client" />`.
- [ ] `src/net/gm.ts`: `gmFetch()` Promise wrapper over `GM_xmlhttpRequest`
      (+ abort wiring).
- [ ] `src/settings.ts`: schema + defaults + `GM_getValue/GM_setValue` (secret.* split).
- [ ] `src/main.ts`: on YouTube, log merged settings + one successful `gmFetch` GET
      to `raw.githubusercontent.com` (proves cross-origin works, `@connect`
      prompt appears once).
- **DoD:** Dev userscript installs in Tampermonkey; YouTube console shows settings
  + a 200/404 from a raw GET via `gmFetch`. **Validation:** `tsc --noEmit`, `pnpm build`.
- **Rollback point:** commit "chore: scaffold userscript + gmFetch".

## M1 — Subtitle interception & model
- [ ] `src/intercept/netHook.ts`: patch `unsafeWindow.fetch` + `XMLHttpRequest`;
      emit parsed timedtext JSON; observe-only (return untouched response).
- [ ] `src/subtitles/timedtext.ts` (types + JSON→`Cue[]`), `cues.ts`
      (ASR grouping, `findCueAt`).
- [ ] `src/youtube.ts`: `getVideoId()`, `onNavigate()` (`yt-navigate-finish`),
      `ensureCaptions()`.
- [ ] `src/core/store.ts`: cues/currentTime/AbortController/subscribe; reset on nav
      + new timedtext; `tlang` skip.
- [ ] `src/main.ts`: wire interceptor → build cues → log `Cue[]`.
- [ ] Unit tests: timedtext fixtures (manual/ASR/tlang) → cues.
- **DoD:** Enabling CC logs a correct `Cue[]`; switching videos resets + re-parses.
  **Validation:** `pnpm test` + manual.
- **Rollback point:** commit "feat: timedtext interception + cue model".

## M2 — Translation pipeline (OpenAI-compatible via gmFetch)
- [ ] `src/translate/prompt.ts`: system/user templates + placeholder fill
      (incl. ASR punctuation restoration).
- [ ] `src/translate/openai.ts`: numbered batch translate through `gmFetch`;
      `/chat/completions` + `/responses`; `parseNumbered` + count-check + retry ≤3.
- [ ] `src/translate/pipeline.ts`: chunk(40) → pool(4) → assemble → assert all `t`;
      honor `AbortSignal`; fail-closed on any batch failure.
- [ ] Unit tests: `parseNumbered` (happy/missing/extra/reordered); pipeline
      assembly + fail-closed (mock `gmFetch`).
- **DoD:** Fixture cues + real key → fully translated cues; injected batch failure
  → thrown error, no partial result. **Validation:** `pnpm test` + one manual run.
- **Rollback point:** commit "feat: whole-video translation pipeline".

## M3 — Bilingual overlay
- [ ] `src/ui/overlay.ts`: two stacked divs on `#movie_player`; hide native
      captions (injected style); native-style mirror; `bilingual`/`translation-only`.
- [ ] `src/main.ts`: rAF/`timeupdate` → `store.setCurrentTime`; subscriber renders
      `findCueAt`. Temporarily call pipeline directly (pre-cache) to see translations.
- **DoD:** Original + translation render in sync; native captions hidden; mode
  toggle works. **Validation:** manual on 2–3 videos.
- **Rollback point:** commit "feat: bilingual overlay".

## M4 — L1 local cache
- [ ] `src/cache/key.ts` (`cacheKey`/`shard`/`repoPath`); `src/cache/l1.ts` (idb:
      `getL1`/`putL1`, optional eviction).
- [ ] `src/core/resolve.ts`: L1 → translate → `putL1`; return `source`.
- [ ] Route `main.ts` translation through `resolve()` (drop temp direct call).
- **DoD:** First load translates; reload is instant with **no** OpenAI call
  (devtools verify). **Validation:** manual network check + `pnpm test`.
- **Rollback point:** commit "feat: L1 IndexedDB cache".

## M5 — L2 GitHub pool repo (via gmFetch)
- [ ] `src/cache/l2github.ts`: `readL2` (raw GET, 404=miss), `writeL2`
      (get-sha-then-PUT, base64 body), all through `gmFetch`.
- [ ] `resolve.ts` full order: L1 → L2 (→putL1) → translate → putL1 →
      **writeL2 on success only**; L2 write failure = soft-log, keep L1.
- [ ] Unit tests: URL/path/sha/base64 builders; 404 handling (mock `gmFetch`).
- **DoD:** Cache-miss video → after full translation, exactly one repo file at the
  sharded path matching schema; failed translation writes nothing; a fresh
  Tampermonkey profile pointed at the repo loads it with **zero** OpenAI calls.
  **Validation:** manual E2E vs throwaway public repo + acceptance matrix.
- **Rollback point:** commit "feat: L2 GitHub repo read/write".

## M6 — Settings panel & secrets
- [ ] `src/ui/settings-panel.ts`: in-page modal (vanilla DOM, style-isolated) —
      target lang, display mode, OpenAI (baseUrl/model/key), GitHub
      (owner/repo/branch/PAT), two "Test connection" buttons.
- [ ] `GM_registerMenuCommand('Gistlate 设置', openPanel)`; persist via `settings.ts`
      (secrets under `secret.*`, never logged).
- [ ] Runtime handling if `@connect *` triggers a Tampermonkey allow-prompt.
- **DoD:** Settings persist across reload; both tests report success/failure;
  secrets under `secret.*` GM keys. **Validation:** manual; inspect GM storage.
- **Rollback point:** commit "feat: settings panel + GM menu".

## MVP integration gate (last-iteration full-scope check)
- [ ] Run the **entire** `prd.md` Acceptance Criteria matrix end-to-end.
- [ ] `pnpm exec tsc --noEmit && pnpm build && pnpm test` all green.
- [ ] Dispatch `trellis-check` for spec compliance + cross-layer review.
- [ ] Confirm: no partial L2 writes, zero-OpenAI on L2 hit, SPA reset correct,
      `@connect`/`@grant`/`@match`/`@run-at` correct in built `.user.js` header.

---

## M7 — Sharing polish (POST-MVP, separate task)
Canonical pool-repo scaffold (README/schema/PR template/CI), contributor handle,
re-translate/overwrite UX, Violentmonkey/Firefox `exportFunction` pass,
Greasyfork publish + `@updateURL`. Track as a follow-up task; do not block MVP.

## Risks / mitigations
- YouTube DOM/timedtext changes → minimal interception; fixtures pin parsing.
- LLM output drift → count-check + retry + fail-closed.
- GitHub rate/CDN lag → L1 in front; soft-fail L2 writes.
- `unsafeWindow.fetch` assignment on Firefox/GM → `exportFunction` (deferred to M7;
  Chrome/Tampermonkey primary works with direct assignment).
- `@connect *` user prompt → documented; consider narrowing to known hosts later.
