# Implementation plan: long-video translation budget guard

## Scope and workflow

- Work inline in the main Codex session; project config defaults to the Trellis
  inline workflow, so no sub-agent manifests are required.
- Before source edits, run `trellis-before-dev` and load the frontend package
  checklist plus the task PRD/design.
- Keep this task's code/spec commit separate from the already committed
  subtitle-browser and ASR sentence-limit work. Do not rewrite those commits.
- Do not call `task.py start` until the user approves this completed plan.

## Execution status

- Steps 1–6 are complete: targeted tests, full suite, TypeScript compile,
  production build, Trellis quality review and static IIFE/Trusted Types checks
  pass.
- Step 7 remains a user-side acceptance handoff. Chrome exposed the existing
  YouTube page, but its security policy blocked direct automation of the
  Tampermonkey extension page; no extension storage, cookies or secrets were
  inspected and no workaround was attempted.
- Step 8 is complete: feature/spec commits `84d3431` and `73d29db` passed the
  final gate and were pushed to `origin/master`.

## Step 1 — Settings and pure guard policy

- [ ] Add `AutoTranslateLimitMinutes` and
      `translation.autoTranslateLimitMinutes` in `src/settings.ts`.
- [ ] Default/migrate to 45; accept only 15/30/45/60/90/120 or `null` for
      unlimited finite replays.
- [ ] Add the discrete select and explanatory hint to
      `src/ui/settings-panel.ts`; preserve all unrelated settings/style fields
      during save.
- [ ] Add `src/core/long-video-guard.ts` with pure caption scale, strict
      threshold, current-live override and qualitative-risk helpers.
- [ ] Test malformed settings, old settings migration, exact threshold,
      unlimited finite replay, live precedence, Unicode code-point counts and
      risk bands.

Validation:

```powershell
pnpm vitest run src/settings.test.ts src/core/long-video-guard.test.ts
pnpm compile
```

Rollback point: additive settings and pure policy compile without orchestration
changes.

## Step 2 — Matching YouTube playback facts

- [ ] Extend the private player-response types in `src/youtube.ts` with the
      minimal live-broadcast fields actually read.
- [ ] Add `getPlaybackFacts(expectedVideoId)` using matching player response,
      live-now/end metadata and native video duration.
- [ ] Treat ended live content as a finite replay; never classify from
      `isLiveContent` alone or from a temporarily unknown duration alone.
- [ ] Add unit tests for current live, infinite duration, ended replay, stale
      player response and ordinary `NaN`-duration startup.

Validation:

```powershell
pnpm vitest run src/youtube.test.ts src/core/long-video-guard.test.ts
pnpm compile
```

Rollback point: playback facts are read-only and not yet wired to activation.

## Step 3 — Cost-safe resolve preflight

- [ ] Add the typed async `beforeFreshTranslation` decision contract and
      ready/skipped `ResolveResult` union in `src/core/resolve.ts`.
- [ ] Preserve L1/L2/direct behavior; invoke preflight only after both compatible
      reads miss or after force intentionally skips reads.
- [ ] Move provider-secret loading and keep `onTranslating`, ledger creation,
      collector construction and translation strictly after `continue`.
- [ ] Recheck abort around the awaited preflight and return skips without
      throwing or finalizing a nonexistent operation.
- [ ] Update existing resolve callers/tests for the tagged ready result.
- [ ] Add explicit zero-side-effect tests for automatic guard, manual decline,
      settings-opened skip, live skip and force skip.

Validation:

```powershell
pnpm vitest run src/core/resolve.test.ts src/usage
pnpm compile
```

Rollback point: this is the principal provider-cost safety boundary; do not wire
the UI until all skip-path call-count assertions pass.

## Step 4 — Guard dialog, status and GL presentation

- [ ] Add a createElement/textContent-only guard dialog module with finite
      confirm and information-only live variants.
- [ ] Show title, exact span/cue/code-point scale, current mode/batch size,
      qualitative risk and the returned-usage billing warning.
- [ ] Provide cancel, open existing translation settings and explicit whole-video
      continue actions; prevent Enter/backdrop/Escape from confirming.
- [ ] Make dialog cleanup/abort idempotent across SPA navigation.
- [ ] Add 8-second finite/live guard statuses in `src/ui/status.ts`.
- [ ] Extend `src/ui/style-button.ts` with guarded inactive tooltip state while
      retaining `aria-pressed=false` and current active styling.
- [ ] Unit-test pure formatting/decision helpers; where DOM behavior is not
      practical in the Node test environment, cover it with the final Chrome
      interaction matrix rather than adding an unsafe fake DOM dependency.

Validation:

```powershell
pnpm vitest run src/ui src/core/long-video-guard.test.ts
pnpm compile
```

Rollback point: UI modules exist independently of the activation state machine.

## Step 5 — Main activation and retranslation integration

- [ ] Add activation intent and memory-only `GuardedVideoState` ownership in
      `src/main.ts`.
- [ ] Extend the pure auto-start policy to suppress the same guarded video
      without treating it as a user-disabled video.
- [ ] Build the preflight closure from current settings, caption metrics and
      matching playback facts.
- [ ] Handle a typed skip distinctly from errors. For a fresh activation, reset
      Store, destroy overlay/status as needed, reveal native captions, clear
      active/current track and retain only guarded identity/metrics.
- [ ] Preserve a completed Store/overlay when a force-retranslation preflight is
      cancelled, opens settings or rejects current live.
- [ ] Route guarded `GL` and the existing Tampermonkey retranslation fallback
      through normal reacquisition/cache resolution so changed settings, an
      ended live stream and newly appeared L2 artifacts are re-evaluated.
- [ ] Ensure each retry creates a new dialog decision and no authorization is
      persisted.
- [ ] Clear guarded state/dialog/title on navigation and keep native captions
      visible after guarded cleanup.
- [ ] Add/extend activation tests for guarded suppression, next-video clearing,
      force preservation and no duplicate operation ownership. Extract small
      pure transition helpers if direct `main.ts` tests would require page-world
      globals.

Validation:

```powershell
pnpm vitest run src/core src/youtube.test.ts src/ui
pnpm compile
```

Rollback point: end-to-end integration; guard must fail closed before any
provider operation but must not turn UI cancellation into a translation error.

## Step 6 — Full regression and static build gate

- [ ] Run the complete unit/integration suite, TypeScript compile and production
      build.
- [ ] Inspect the built userscript for one IIFE and zero SystemJS/dynamic imports.
- [ ] Inspect for Trusted Types regressions (`innerHTML`, `outerHTML`,
      `insertAdjacentHTML`, document-write sinks) and leftover debug statements.
- [ ] Verify settings migration from a pre-guard stored object.
- [ ] Verify direct-target and L1/L2 long-video cases never show a guard.
- [ ] Verify a skipped fresh miss creates zero DeepSeek, usage-operation and
      artifact writes.

Quality commands:

```powershell
pnpm compile
pnpm test
pnpm build
git diff --check
rg -n "System\.register|systemjs|import\(" dist/gistlate.user.js
rg -n "innerHTML|outerHTML|insertAdjacentHTML|document\.write" src dist/gistlate.user.js
git status --short --branch
```

## Step 7 — Chrome acceptance matrix

- [ ] Install the local production build in Tampermonkey/Chrome.
- [ ] Test a finite video below 45 minutes: existing automatic behavior.
- [ ] Test a finite replay above 45 minutes with a forced genuine cache miss:
      native captions appear, 8-second notice, inactive guarded GL tooltip, zero
      usage-ledger operation.
- [ ] Test cancel, settings, and continue. Confirm only continue begins exactly
      one operation and uses the selected sentence/batch/whole mode.
- [ ] Abort/fail the confirmed attempt and verify the next retry asks again.
- [ ] Test an existing long L1/L2 artifact and a target-language direct track:
      immediate display without prompt.
- [ ] Test `unlimited finite replays`: finite fresh work proceeds, current live
      still has an information-only dialog.
- [ ] Test force retranslation cancel on an active long artifact: old translated
      subtitles remain visible.
- [ ] Test SPA navigation while the auto notice and confirmation dialog are open:
      no stale status/title/overlay or provider request leaks to the next video.

Do not expose browser cookies, Tampermonkey secrets or API keys in logs or task
artifacts. A real DeepSeek call is optional for the guard proof; if used, choose
one explicitly confirmed operation and verify its returned usage remains handled
by the existing ledger.

## Step 8 — Spec, commit and release handoff

- [ ] Run `trellis-check` after all source changes and address every finding.
- [ ] Update `.trellis/spec/frontend/quality-guidelines.md` with the executable
      cache-before-guard-before-usage contract, live exception, single-use
      authorization and native-caption cleanup behavior.
- [ ] Re-run the full gate after spec changes and review the complete diff.
- [ ] Commit source, tests, task artifacts and spec as this independent feature;
      do not squash/rewrite the two predecessor commits already on local master.
- [ ] Push only after the normal Git credential path succeeds. If GitHub still
      returns 403, keep the verified commits local and report the exact handoff
      command instead of reading or altering user credentials.
- [ ] Finish/archive the Trellis task after the code commit and session record
      are complete.

## Primary risks and rollback notes

- Highest risk: placing the guard before cache reads would hide free artifacts;
  placing it after ledger creation would record/bill guarded work. Resolve tests
  must pin the exact boundary.
- Next risk: current-live false positives on ended replays. Require matching
  live-now/infinite evidence and treat end metadata as finite.
- Next risk: force-cancel cleanup could erase a valid displayed artifact. Keep
  fresh-activation cleanup and force-retranslation preservation as distinct
  transitions.
- Next risk: a remembered bypass could authorize unintended retries. Store only
  guarded identity/metrics, never an allow flag.
- Next risk: settings-panel whole-object saves can drop new fields. Update every
  Settings constructor and migration test together.
- Rollback needs no data migration: the setting is additive, artifacts/usage DB
  are unchanged, and guarded attempts persist nothing.
