# Translation context, explicit retranslation, and sentence length cap

## Goal

Improve subtitle translation accuracy and on-screen readability by giving the
translator video-level context (title and description), allowing users to
explicitly regenerate a cached translation, and preventing a reconstructed
sentence from becoming an excessively long display cue.

## User Value

- Ambiguous names and phrases are translated with the video's subject in mind
  instead of from subtitle text alone.
- Users can refresh a poor or stale translation without manually clearing local
  storage or editing the shared GitHub pool.
- Long reconstructed sentences remain readable as subtitles without sacrificing
  the existing original/translation/time alignment guarantees.

## Confirmed Facts and Constraints

- This is the next implementation child of
  `07-12-kiss-inspired-enhancements`; subtitle display polish is already done and
  word-level statistical segmentation remains a separate later child.
- Translation is eager and whole-track. It uses a validated two-pass flow:
  source-fragment boundary detection first, then strict 1:1 translation of the
  resulting display ranges.
- The current application has no video title/description extraction, explicit
  retranslation action, or long-sentence display limit.
- Cache identity is currently `videoId|src|tgt`; model and prompt configuration
  are metadata only. A cache hit skips the translator completely.
- The stored cue artifact shape must remain `{s,d,o,t}`. This task must not
  require an L1 or L2 schema migration.
- Sentence/translation/time alignment is a hard invariant. No design may ask the
  model to freely split translated text and then guess timing afterward.
- Settings must remain backward-compatible when older stored settings omit all
  new fields.
- The shipped userscript must remain a single static-import IIFE and must keep
  using Trusted-Types-safe DOM construction.

## Requirements

### R1 — Video title and description context

- Translation requests must include the current video's title and description as
  contextual information when reliable values are available.
- Missing or temporarily unavailable title/description data must not block
  translation.
- Title and description are context only. They must never be treated as subtitle
  text or appear as extra translated cues.

### R2 — Readable display-cue length

- Excessively long reconstructed sentences must be split into shorter display
  ranges before translation output is attached to time ranges.
- Splitting must preserve complete, ordered, non-overlapping coverage and keep
  every translation attached to the same source-fragment range used for timing.
- Use fixed internal targets rather than adding another user setting: about 15
  whitespace-delimited words for space-separated languages and about 30 visible
  CJK characters for unspaced text.
- Split only at existing source-fragment boundaries, preferring punctuation,
  pauses, or natural fragment ends when more than one valid boundary is nearby.
- If one source fragment alone exceeds the target, keep it intact and allow the
  overlay to wrap it. Accurate intra-fragment splitting belongs to the later
  word-level timestamp task.

### R3 — Cache and retranslation behavior

- Provide an explicit **Retranslate current video** action.
- Expose the action as a Tampermonkey menu command alongside the existing
  settings and subtitle-style commands; do not add another persistent player
  control.
- Require confirmation before starting because the action consumes LLM quota and
  may replace a shared GitHub artifact.
- Retranslation must bypass both L1 and L2 reads and use the current title,
  description, and translation settings.
- The existing cached artifact remains usable while retranslation is in progress
  and must remain unchanged if the operation fails or is aborted.
- Only a fully successful retranslation may replace the L1 artifact and overwrite
  the same L2 artifact.
- Preserve the existing shared cache identity and `{s,d,o,t}` cue schema; no
  migration or parallel versioned artifact is required.

### R4 — Reliability and compatibility

- Abort, retry, fallback, and write-on-full-success behavior must remain intact.
- Failed or aborted translations must not write partial L1/L2 artifacts.
- Existing settings and existing cached artifacts must remain readable.
- Existing translation, segmentation, cache, and build tests must stay green,
  with focused tests added for the new contracts.

## Acceptance Criteria

- [x] On a cache miss, the translation prompt contains the current video title
      and description when available, without adding an output slot.
- [x] Long reconstructed content is split according to the approved limit while
      preserving ordered, gap-free source-range coverage and valid cue timing.
- [x] The length cap has no new user-facing setting; space-separated and CJK
      inputs use the fixed approved targets.
- [x] A single over-limit fragment remains one aligned cue rather than receiving
      guessed intra-fragment timing.
- [x] Missing title/description preserves the current translation behavior.
- [x] A user can explicitly retranslate the current video; the operation bypasses
      L1/L2 reads, overwrites them only after full success, and preserves the old
      artifact on failure or abort.
- [x] Retranslation is available from the Tampermonkey menu, asks for confirmation,
      and does not add another permanent YouTube player button.
- [x] Translation failure or navigation abort still writes no partial artifact.
- [x] Stored cue JSON remains `{s,d,o,t}` with no migration required.
- [x] `pnpm compile`, `pnpm test`, and `pnpm build` pass; the build remains one
      IIFE with no SystemJS/dynamic-import loader.

## Out of Scope

- Word-level timestamp preservation and MAD/Z-score sentence breaking.
- Manual or automatic terminology glossary management and an extra LLM
  translation-brief/term-extraction request. This product is an auxiliary video
  viewer; users can interpret specialist terminology themselves.
- Translation memory across unrelated videos.
- Changing the shared cue artifact schema.

## Open Product Decisions

None. The remaining choices are implementation details constrained by the
requirements above.
