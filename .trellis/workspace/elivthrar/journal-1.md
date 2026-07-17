# Journal - elivthrar (Part 1)

> AI development session journal
> Started: 2026-07-09

---



## Session 1: Gistlate MVP: YouTube bilingual subtitle userscript with LLM + GitHub repo cache

**Date**: 2026-07-11
**Task**: Gistlate MVP: YouTube bilingual subtitle userscript with LLM + GitHub repo cache
**Branch**: `master`

### Summary

Built Gistlate as a Tampermonkey userscript (vite-plugin-monkey, vanilla TS): intercepts YouTube timedtext, translates whole tracks via OpenAI-compatible API (DeepSeek), renders bilingual overlay, caches to L1 IndexedDB + L2 GitHub repo (pool branch). Fixed runtime bugs: Trusted Types innerHTML, SystemJS TrustedScriptURL (removed dynamic imports), same-track re-interception aborting translation, unsafeWindow.fetch Request reconstruction, overlay race. Set up two-branch monorepo (master=code, pool=orphan data) + release CI. Verified working end-to-end.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `961826d` | (see git log) |
| `1f55a9d` | (see git log) |
| `d7bff34` | (see git log) |
| `df7732a` | (see git log) |
| `cfe62c1` | (see git log) |
| `49ba067` | (see git log) |
| `409837f` | (see git log) |
| `c5af631` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Style panel + one-shot translation + status pill

**Date**: 2026-07-11
**Task**: Style panel + one-shot translation + status pill
**Branch**: `master`

### Summary

Added a live WYSIWYG subtitle style panel (CSS-variable driven overlay, docked card, control-bar 'Aa' button + floating/GM fallbacks). Rewrote translation to one-shot whole-transcript (full-video context, consistent terminology) with adaptive recursive split fallback on truncation/count-mismatch; removed fixed-40 batching + concurrency pool; tests use fake timers (~14s->1s). Added a transient on-screen translation status pill (translating/done/failed) shown only on cache-miss. trellis-check passed (M1 6/6, M2 6/6); captured Trusted-Types/single-IIFE + YT DOM-injection + CSS-var-restyle lessons into frontend specs.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `79e45cb` | (see git log) |
| `d240ffc` | (see git log) |
| `7459dcb` | (see git log) |
| `2a9e0a1` | (see git log) |
| `19be82a` | (see git log) |
| `3fa1726` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Sentence reconstruction (two-pass) + non-speech stripping

**Date**: 2026-07-12
**Task**: Sentence reconstruction (two-pass) + non-speech stripping
**Branch**: `master`

### Summary

Sentence-level subtitle translation for monologue/ASR. First shipped one-pass LLM segment+translate+report-ranges, which MISALIGNED (reported ranges drifted from translations). Reworked to reliable TWO-PASS: pass 1 per-fragment boundary flags (validated) -> deterministic grouping; pass 2 translate whole sentences via the proven 1:1 translator -> alignment guaranteed by construction. Sentence-cue end clamped to next sentence start (ASR overlapping durations). Non-speech [Music]/【音乐】/♪ stripped before segmentation. Fixed double-translation from spurious yt-navigate-finish + skip null videoId. trellis-check passed (AC 6/6). Studied fishjar/kiss-translator; captured alignment rules into spec.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a7c7da2` | (see git log) |
| `5975644` | (see git log) |
| `a3e8d09` | (see git log) |
| `81644cb` | (see git log) |
| `994a9bb` | (see git log) |
| `28057be` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Subtitle display polish (linger fix, control-bar, seek); drag dropped

**Date**: 2026-07-12
**Task**: Subtitle display polish (linger fix, control-bar, seek); drag dropped
**Branch**: `master`

### Summary

Fixed subtitle lingering through long music/silence gaps (cap sentence-cue end at min(nextStart, rawEnd+1.2s)). Control-bar-aware positioning (raise subtitle when YouTube controls show via ytp-autohide observer). Seek sync (force overlay refresh on seeked). Draggable subtitle attempted but dropped — YouTube's click-capture layer sits above the overlay and eats pointer events. First of the kiss-translator-inspired child tasks (parent 07-12-kiss-inspired-enhancements).

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `38cde9b` | (see git log) |
| `27b4d99` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Context-aware retranslation and readable cue caps

**Date**: 2026-07-17
**Task**: Context-aware retranslation and readable cue caps
**Branch**: `master`

### Summary

Added bounded YouTube title/description context, safe explicit force retranslation that preserves old results until full success, and fragment-aligned English/CJK cue-length capping. Added cache/abort, prompt, metadata, segmentation, and pipeline coverage; compile, 100 tests, production build, single-IIFE audit, and live YouTube metadata probe passed.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9ae32a5` | (see git log) |
| `faebf2d` | (see git log) |
| `abf4da2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
