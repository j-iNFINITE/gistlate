# kiss-translator-inspired enhancements

Parent task. Owns the requirement set + child map for a batch of improvements
borrowed from `fishjar/kiss-translator` (studied 2026-07-12). Not an implementation
target itself; each child is planned, implemented, checked, and archived on its own.

## Source

kiss-translator (简约翻译) — mature bilingual translation extension/userscript with a
strong YouTube subtitle pipeline. Borrowed ideas, clean-room (its license aside);
we do not copy code.

## Children (independently verifiable)

- **07-12-translate-context-glossary** — Translation quality, prompt-level (small):
  inject the **video title** as context; support a **glossary/terminology** list;
  cap **sentence length** for on-screen readability (split overly long sentences).
- **07-12-word-level-segmentation** — Segmentation, architectural (large): keep
  **word-level** timestamps from timedtext (currently merged to cue-level) and port a
  **statistical sentence breaker** (word-gap MAD/Z-score + linguistic features) so
  boundaries are deterministic, LLM-free, and time-accurate. May supersede the
  current two-pass LLM boundary detection.
- **07-12-subtitle-display-polish** — Rendering (moderate): control-bar-aware
  positioning, draggable subtitle, seek sync, and the **lingering-subtitle fix**
  (cap sentence-cue duration so it doesn't stay on screen through long music/silence
  gaps).

## Cross-child notes / ordering

- Recommended order: **display-polish → translate-context-glossary →
  word-level-segmentation** (fix the visible linger bug + polish first, quick
  translation wins next, big refactor last).
- The linger fix (display-polish) and word-level-segmentation both touch cue timing;
  the display-polish fix is a small cap on the *current* `sentencesToCues`, while
  word-level-segmentation later reworks timing wholesale — carry the same
  "don't linger through gaps" principle forward.
- No child changes the stored artifact schema (`{s,d,o,t}`).

## Parent-level acceptance

- [ ] All three children implemented, checked, and archived.
- [ ] The shipped userscript still builds as a single IIFE, tests green, no schema
      migration required.
