# Recover coarse YouTube ASR boundaries and log runtime version

## Goal

Make the running userscript identify its real installed version in startup logs,
and prevent valid YouTube ASR tracks from failing before translation when JSON3
either exposes only coarse event timing or contains a long silence between
word-timed events.

## Confirmed facts

- GitHub Release `v0.2.16` is internally consistent. Its built line fingerprints
  differ from `v0.2.15`, while an already-open YouTube SPA tab can continue to
  run the older injected instance after Tampermonkey updates its stored script.
- The runtime currently logs only `Script loaded on YouTube`; it does not expose
  `GM_info.script.version`, so version diagnosis depends on brittle line numbers.
- `5zKyUcKU134` has produced two real failure shapes from the same `a.en` ASR
  track:
  - 395 intercepted coarse cues: sentence 1 collapsed to 22,879 ms, 539 source
    characters, and six terminal marks because sentence ends inside a coarse cue
    were inexpressible to the one-E/C-per-cue boundary model.
  - 1,188 direct word-timed cues: sentence 323 became 38,320 ms despite only 32
    source characters and one terminal mark.
- `parseWordTimedEvents` currently maps each fragment duration to the next
  fragment start. That gap-free rule assigns a long silent interval to the
  preceding spoken fragment even when the JSON3 event has a much earlier
  natural end.
- The existing 30-second / 480-code-point / three-terminal-mark checks are
  fail-closed corruption guards and must not be loosened to hide either parser
  defect.

## Requirements

### R1 — Runtime version observability

- The first Gistlate startup log must include the version of the userscript that
  Tampermonkey actually injected, sourced from `GM_info.script.version`.
- Keep the stable `[Gistlate]` prefix so existing console filters continue to
  work.
- Do not log script source, settings secrets, extension storage, build paths, or
  any other `GM_info` fields.

### R2 — Preserve long ASR silence as a gap

- Word-timed parsing must retain a natural end for each source fragment instead
  of always stretching it to the next fragment start.
- A reported event end or conservative fallback event end must bound its final
  spoken token when the next visible event starts much later.
- Emitted cues must remain sorted, positive-duration, and non-overlapping, but
  may contain a real gap with no active subtitle.
- Internal packed-sentence timing must remain proportional and monotonic.

### R3 — Recover sentence ends from coarse ASR events

- When the selected track is explicitly ASR but dense word offsets are not
  usable, preserve legacy event acquisition while splitting explicit terminal
  punctuation inside each coarse event.
- Emit a boolean `sentenceEnd` for every resulting internal source cue: true at
  recovered punctuation, false for an event tail that continues, and true for
  the final visible cue.
- Allocate multiple fragments within one event over that event's bounded time
  interval by Unicode code-point position; do not emit a sequence of 1 ms cues.
- Preserve decimal/version periods and punctuation runs under the existing
  sentence-mark rules.

### R4 — Compatibility and failure behavior

- Explicit manual tracks remain one authored cue per translation owner and must
  not receive ASR punctuation recovery.
- Existing dense word-timed ASR source text and deterministic sentence flags
  remain compatible.
- Cleaned source text must not be lost, duplicated, or reordered.
- Successful deterministic ASR boundaries continue to bypass the boundary API;
  no fabricated usage or cost is recorded.
- Do not change cache keys or persisted artifact cue shape `{s,d,o,t}`.
- Do not change the existing false-mega-sentence limits.

## Acceptance criteria

- [x] Startup output contains `[Gistlate]` and the actual Tampermonkey runtime
      version from `GM_info.script.version`.
- [x] A word-timed fixture with a short punctuated event followed by a roughly
      38-second silence leaves a subtitle-free gap and no longer stretches the
      first cue beyond its natural event end.
- [x] The long-silence fixture can reach sentence planning without the reported
      `Sentence ... exceeds safety limit (38320ms, 32 chars, 1 stops)` failure.
- [x] An explicitly ASR coarse-event fixture containing multiple English
      sentences is split at internal terminal punctuation with complete boolean
      `sentenceEnd` hints and positive monotonic timing.
- [x] The same sparse-offset fixture without explicit ASR identity retains the
      established legacy fallback, and an explicit manual fixture is unchanged.
- [x] Existing real high-density English regressions (243/321 code points),
      Japanese word-timed regressions, and packed-segment proportional timing
      still pass.
- [x] Full tests, type-check, and production build pass.
- [x] The production userscript remains a single IIFE with no SystemJS,
      dynamic-import loader, or Trusted Types HTML/script sink regression.

## Out of scope

- Raising safety limits.
- Changing translation prompts, terminology handling, pricing, or cache
  identity.
- Inferring punctuation for completely unpunctuated ASR using a new statistical
  or model-based algorithm.
- Reading Chrome cookies, Tampermonkey storage, API keys, or extension source.
