# Gistlate Translation Pool

This is the **`pool`** branch of the Gistlate project — an **orphan branch** that
shares no history with `main` (the userscript source). It stores community
contributed YouTube subtitle translations produced by the
[Gistlate userscript](../../tree/main).

> Looking for the code? Switch to the [`main` branch](../../tree/main).

## Layout

```
data/{first-2-chars-of-videoId}/{videoId}.{srcLang}-{tgtLang}.json
```

Example: a translation of video `dQw4w9WgXcQ` from English to Simplified Chinese
lives at `data/dQ/dQw4w9WgXcQ.en-zh-Hans.json`.

## Artifact format

Each file is one video's full subtitle track with original + translated text.
See [`schema/video-translation.schema.json`](schema/video-translation.schema.json).

```json
{
  "key": "VIDEOID|en|zh-Hans",
  "videoId": "VIDEOID",
  "src": "en",
  "tgt": "zh-Hans",
  "model": "deepseek-chat",
  "cues": [
    { "s": 0, "d": 2000, "o": "original text", "t": "译文" }
  ],
  "createdAt": 1700000000000
}
```

- `s` = start (ms), `d` = duration (ms), `o` = original, `t` = translated.
- `model` is metadata only; a translation by any model is reusable.

## How to contribute

1. **Fork** this repository on GitHub.
2. Install the Gistlate userscript and open its settings. Point the GitHub pool
   at your fork: `owner = <your-username>`, `repo = <this-repo>`, `branch = pool`.
3. Watch YouTube videos as usual — when a video has no existing translation, the
   script translates it and commits the JSON to the `pool` branch of your fork.
4. Open a **Pull Request** from your fork's `pool` branch to this repo's `pool`
   branch. CI validates your JSON against the schema.
5. Once merged, everyone pointing at this pool reuses your translation for free.

**Do not** open PRs against `main` here — that branch is the code.

## Validation

`scripts/validate.mjs` (dependency-free Node) checks every `data/**/*.json`
against the schema and the filename/shard convention. It runs in CI on every PR.
Run locally with:

```sh
node scripts/validate.mjs
```
