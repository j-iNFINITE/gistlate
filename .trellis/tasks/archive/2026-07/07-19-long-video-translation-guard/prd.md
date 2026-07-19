# Long-video translation budget guard

## Goal

Prevent automatic navigation into multi-hour videos or live replays from
starting a large DeepSeek translation operation that the viewer did not intend
to pay for, while preserving free direct-target and cache-hit behavior.

## User Value

- Opening a long replay cannot silently enqueue thousands of requests.
- Existing completed translations still appear automatically at zero new model
  cost.
- The user can inspect original subtitles first and explicitly override the
  guard when full translation is genuinely wanted.

## Confirmed Facts

- `autoStart` currently defaults to true and activates every eligible Watch
  video unless the current video was manually suppressed.
- Caption acquisition, target-language direct display, L1 lookup and L2 lookup
  do not call DeepSeek. The guard therefore belongs after cache misses and
  before the usage operation / boundary / translation pipeline begins.
- Sentence and batch modes repeat a stable whole-video transcript prefix. A low
  cache-hit unit price does not remove the cost risk because both transcript
  length and request count grow with video length.
- `video.duration` may be `Infinity`, temporarily unknown, or include long
  silent sections. The actual caption span from the final source cue is the more
  relevant primary measure once acquisition completes.
- The existing `GL` player control is the approved primary override entry. A
  Tampermonkey menu command remains the fallback; no extra permanent player
  control is needed.
- Prior approval of progressive translation applies to ordinary requested work;
  it is not consent to automatically translate arbitrarily long videos.
- The user selected a default automatic finite-caption-span limit of 45 minutes.
- The user approved an MVP override that, after explicit confirmation, translates
  the entire video with the currently selected sentence/batch/whole strategy.
  Rolling current-position windows remain a separate follow-up.
- The user chose to restore YouTube native captions and leave Gistlate inactive
  when automatic long-video translation is guarded. Do not retain a source-only
  Gistlate overlay/current-transcript state.
- The user approved a confirmation dialog that shows the current translation
  strategy but does not duplicate its controls. It offers cancel, open the
  existing settings panel, or continue with the current strategy.
- The user approved a configurable finite-replay limit with discrete choices of
  15/30/45/60/90/120 minutes and “unlimited finite replays”. The default and
  old-settings migration value is 45 minutes. Current live streams remain
  guarded even when finite replays are unlimited.
- The user rejected preflight CNY estimates for the MVP. The override dialog
  shows reliable caption span, cue/source scale, current strategy and a
  qualitative request-risk level; actual provider usage/cost remains the only
  authoritative monetary record after requests return.
- The user decided that a current live/indefinite stream cannot be manually
  overridden in the MVP. Automatic and manual full-history translation must
  wait until the stream ends and becomes a finite replay; real-time rolling
  translation is a separate future system.
- The user approved a non-blocking guarded-replay notice in the existing player
  status pill. It remains visible for about eight seconds, then auto-hides. The
  inactive `GL` control keeps a guarded-video tooltip so the manual override
  remains discoverable after the notice disappears.
- Long-video confirmation grants authority for exactly one billable translation
  operation. It is not remembered as a session- or video-wide bypass. A failed,
  aborted or deliberately restarted attempt requires a new confirmation;
  subsequent compatible cache hits remain prompt-free because they create no
  new provider operation.
- The user rejected numeric preflight request-count estimates. The confirmation
  shows exact known inputs (caption span, cue count and source character scale),
  the current strategy, and a qualitative low/medium/high request-risk label.
  Boundaries, alignment and retries make the final request count unknowable
  until the provider operations actually run.

## Requirements

### R1 — Zero-cost preflight boundary

- Continue selecting/acquiring the canonical subtitle track before deciding
  whether a translation is needed.
- A target-language direct track, compatible L1 artifact, or compatible L2
  artifact must display normally regardless of video length.
- Invoke the long-video guard only on a genuine fresh cache miss and before
  creating a usage-ledger operation or sending any provider request.
- A guarded skip must generate zero boundary, translation, alignment and usage
  requests and must not be recorded as a failed translation operation.

### R2 — Long/live detection

- A currently live or indefinite-duration source must never start automatic
  full-history translation.
- For finite replays, use cleaned caption span as the primary threshold input,
  with finite player duration as a corroborating/fallback value.
- Guard only when the effective finite caption span is strictly greater than
  the configured limit; a span exactly equal to the limit is allowed.
- The automatic limit must be persisted as a user setting with an explicit
  unlimited finite-replay value. Use the approved discrete choices
  15/30/45/60/90/120 minutes rather than arbitrary numeric input; default and
  legacy migration value is 45 minutes.
- “Unlimited finite replays” restores automatic translation only when caption
  span is finite. It must never authorize automatic translation of a current
  live/indefinite stream.
- A current live/indefinite stream must also reject manual full-history
  override. Clicking `GL` may explain that translation becomes available after
  the live stream ends, but must not offer a continue action.

### R3 — Guarded user experience

- Treat a guard decision as an intentional paused state, not an error.
- Restore YouTube native captions, remove the Gistlate overlay/current subtitle
  Store state, and leave the player control in its inactive state.
- Show a bounded, non-error explanation that automatic translation was skipped
  because the caption span exceeds the configured limit.
- For a guarded finite replay, show the explanation for approximately eight
  seconds, including the measured caption span and the instruction to click
  `GL` for manual full-video translation. Do not leave a permanent overlay over
  the video.
- While that guarded replay remains current, the inactive `GL` control tooltip
  must read “长视频保护：点击手动翻译” (or an equivalent localized message).
  Restore its ordinary inactive tooltip on navigation or when the guard no
  longer applies.
- The player control must not claim that translation is running or completed.
  Its tooltip stays concise; detailed cue/source/strategy information belongs
  to the explicit override confirmation, while the bounded skip notice may show
  the measured caption span.
- Do not display a concrete preflight CNY amount. Classify request risk from the
  current strategy and available source scale, and state that boundaries,
  caching, output, alignment and retries determine actual usage.
- Do not display a numeric expected request count or range. Show exact known
  caption span, cue count and source character count alongside the qualitative
  risk label; measured provider usage remains authoritative.

### R4 — Explicit override

- When a guarded video is inactive, clicking the existing `GL` control is the
  primary override entry. A Tampermonkey menu command remains the fallback for
  accessibility/recovery.
- Clicking `GL` is intent to inspect/confirm, not sufficient by itself to start
  a potentially expensive full-video operation.
- Before overriding, require confirmation that names the video/span, exact
  known cue/source scale, current strategy, qualitative request risk and the
  fact that returned requests may remain billable if the page is later closed.
- A confirmed override runs the existing complete-video pipeline and produces
  the normal complete artifact; it does not create a partial/window artifact.
- Treat every confirmed override as a single-use authorization. Do not persist
  an allowlist or reuse the authorization after failure, abort, navigation or a
  new force-retranslation attempt.
- If a confirmed new long-video translation fails, restore the guarded native
  subtitle state so the next `GL` click asks again. A failed/cancelled force
  retranslation must retain the old completed Gistlate subtitles.
- Do not silently switch the user's strategy. The confirmation may recommend
  batch or whole mode, but changing mode remains a deliberate user action.
- Do not duplicate the sentence/batch/whole selector or batch-size input in the
  override dialog. “Open translation settings” delegates editing to the existing
  settings panel; after saving, the user starts confirmation again through `GL`.
- Force retranslation of an already translated long video remains explicit and
  quota-consuming and must continue to require confirmation.
- For a current live/indefinite stream, `GL` only shows the bounded
  “try again after the live stream ends” explanation. It must not create a usage
  operation, send provider requests, write a partial artifact or expose the
  finite-replay continue action.

### R5 — Compatibility and lifecycle

- Preserve cache keys, artifact schema, usage pricing/ledger accuracy, abort
  behavior, current-video suppression and the single static userscript IIFE.
- Navigation must clear any guarded-current-video state so the next ordinary
  video follows normal `autoStart` policy.
- Guarded source-only cues must never be persisted as a successful translated
  artifact.

## Acceptance Criteria

- [ ] A long fresh cache miss produces zero provider and usage-ledger calls.
- [ ] The same long video with a compatible L1 or L2 artifact displays without
      prompting and without new cost.
- [ ] A target-language direct track bypasses the guard and displays directly.
- [ ] A live/indefinite video never starts automatic full-history translation.
- [ ] A live/indefinite video cannot be manually overridden; clicking `GL`
      explains that the user must wait for a finite replay and offers no
      continue action.
- [ ] A finite video below the configured threshold retains existing auto-start
      translation behavior.
- [ ] A guarded long replay restores native YouTube captions, leaves Gistlate
      inactive and shows a non-error explanation for approximately eight
      seconds.
- [ ] After the guarded notice auto-hides, the inactive `GL` tooltip still
      exposes the manual full-video translation entry; navigation restores the
      ordinary tooltip.
- [ ] Explicit override requires confirmation, then uses the existing full
      translation pipeline and records normal measured usage/cost.
- [ ] Canceling or navigating from the guarded state sends no provider request
      and writes no artifact.
- [ ] A failed or aborted confirmed override must be confirmed again before a
      retry; a later compatible L1/L2 hit displays without confirmation.
- [ ] A failed confirmed new long-video attempt returns to inactive guarded
      native captions; force failure/cancel keeps the old translated overlay.
- [ ] Strategy is never changed silently by the guard.
- [ ] Override confirmation shows no fabricated CNY estimate; completed/failed
      operations continue to expose actual provider usage and available cost.
- [ ] Override confirmation shows no numeric request estimate; it exposes the
      exact known span/cue/source scale and a qualitative risk explanation.
- [ ] Settings migration gives old users the approved default threshold,
      accepts only the discrete choices and falls back safely for malformed
      values.
- [ ] Existing acquisition, direct-target, cache, retranslation, progressive,
      ledger and subtitle-browser tests remain green.
- [ ] Production remains one IIFE with zero SystemJS/dynamic imports/HTML sinks.

## Out of Scope for MVP

- Rolling current-position translation windows.
- Per-chunk artifact keys, partial-success persistence or cross-session resume.
- Real-time/live rolling translation.
- Automatically choosing sentence/batch/whole mode on the user's behalf.
- Preflight monetary estimates or numeric request-count estimates; actual
  provider usage remains authoritative.

## Open Questions

- None. The product scope is ready for final planning review.

## Notes

- This is intentionally independent from the semantic-aligned translation and
  stored-subtitle-browser implementation tasks. It may integrate with both but
  must have its own design, tests and commit history.
