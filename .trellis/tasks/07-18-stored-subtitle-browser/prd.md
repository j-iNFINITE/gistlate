# Stored subtitle browser

## Goal

Current-video transcript panel with search, click-to-seek, active-cue highlight and progressive updates; local L1 subtitle library; defer GitHub pool-wide browsing until a remote index strategy is designed.

## Requirements

- Add a current-video transcript side panel backed by the active Store cues.
- Update the panel as progressive translation replaces source-only cues with
  translated cues.
- Provide text search over original and translated content.
- Clicking a transcript row seeks the YouTube player to that cue.
- Highlight and keep the current playback cue visible as the playhead changes.
- Add a local subtitle-library view over existing L1 IndexedDB entries.
- Show available video title, generation strategy, measured provider usage and
  actual CNY cost when optional artifact metadata exists; older artifacts must
  remain browsable.
- Keep subtitle-cache browsing separate from usage-history clearing/retention.
- Preserve Trusted Types rules and the single static-import userscript IIFE.

## Acceptance Criteria

- [ ] Current-video transcript renders ordered cues and updates progressively.
- [ ] Search matches original and translated text without changing cue order.
- [ ] Clicking a cue seeks accurately; playback changes highlight the active row.
- [ ] Local L1 entries can be listed and opened without downloading GitHub data.
- [ ] Old artifacts without optional title/generation/usage metadata render safely.
- [ ] Existing overlay, translation, retranslation, cache and usage-ledger tests pass.
- [ ] Production output remains one IIFE with no SystemJS/dynamic import.

## Out of Scope

- GitHub-pool-wide browsing until a manifest/index and rate-limit strategy is
  designed; the current sharded pool has no browse-friendly index.
- Changing translation, segmentation, pricing or retention behavior.
- Mobile-specific layout beyond a usable responsive baseline.

## Notes

This is a separate follow-up to semantic-aligned progressive translation. It
may consume the optional title/strategy/usage metadata introduced there but must
not become part of that pipeline's persistence boundary.
