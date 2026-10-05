# CASSIE

A CASSIE announcement studio for [SCP: Secret Laboratory](https://scpslgame.com/), running entirely in your browser. Edit an announcement, search the supplied sound bank, adjust playback, preview it, and download WAV or Opus audio.

**Site:** https://cassie.leisiyu.dev

Vue and [platform-kit Fluent](https://github.com/lsy-404/platform-kit) provide the interface. A dedicated Web Worker decodes the supplied Opus clips through `ogg-opus-decoder` WebAssembly and mixes the announcement. FFmpeg WASM loads only for Opus export. Text and rendered audio stay on your device.

## Development

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
npm test
npm run build
npm run test:browser
```

Install the browser once with `npx playwright install chromium` before browser tests. Tests live in `test/`.

## Announcement syntax

Use words from the supplied bank, separated by spaces. Numbers are expanded into speech units where available. The Fluent toolbar inserts game modifiers, while the catalog identifies playable voice, affix and effect clips and supports individual previews.

| Modifier | Meaning |
| --- | --- |
| `$PITCH_1.2` | Set subsequent playback speed and pitch |
| `$VOL_0.7` | Set subsequent voice volume |
| `$STARTT_0.1` | Skip the beginning of the next clip |
| `$MAXDUR_0.3` | Limit the next clip's duration |
| `$SLEEP_0.5` | Delay the next clip |
| `$SPAC_0.2` | Start the next clip this many seconds after the previous start; overlap is possible |
| `$STUTT_0.3_0.1_3` | Repeat a section of the next clip |

The parser is independently implemented from the [documented modern CASSIE grammar](https://en.scpslgame.com/index.php?title=Updates/14.2.3). The renderer has bounded duration and token counts. It does not reproduce the game's announcement queue or promise identical procedural background behavior.

Exact phrase recordings take priority. Available base words can be joined with recorded affixes; missing fragments are reported. Article variants use the following written initial, so pronunciation exceptions may differ from the game.

`$CLIP_id` explicitly inserts any supplied clip, including effects and internal fragments. `$START` and `$END` are application cue commands; they warn and skip when no verified announcement boundary recording is available. They are not game modifiers.

## Experimental phoneme composition

Type space-separated phones between slashes, for example `/ a e: /`, or enter IPA such as `/ h ə l oʊ /`. Direct phoneme blocks work without enabling English word expansion. The interface lists the available measured phones and reports missing units.

Enable experimental phoneme composition to pronounce unrecorded English words using eSpeak's US English pronunciation through `phonemizer`. Existing word, phrase and affix recordings take priority. Pronunciation conversion and composition run locally; missing phones cause the whole unrecorded word to be skipped with a warning.

The index contains 2,761 measured interior windows from 777 source clips, covering 55 IPA keys. Echogarden's synthesis-reference MFCC/DTW alignment estimates boundaries from the actual audio; the first and last phone of each source word are excluded. The renderer joins those windows with short crossfades. These are automatically aligned, context-dependent fragments, so pronunciation and transitions are experimental and can sound rough. This is not a general English TTS voice.

Generation code, timestamp selection and composition code are AGPL-3.0-only. The original and excerpted game audio retain CC BY-SA 3.0. Reproduce the timestamp index using `scripts/build-phonemes.mjs`; the source and output hashes are in `data/phonemes-manifest.json`.

## Cloudflare deployment

```sh
npm run deploy:check
npm run deploy
```

`wrangler.jsonc` deploys **Workers Static Assets** to the configured account and custom domain. There is no server script, database, runtime API, or server-side audio processing. For your own deployment, change the account ID and domain first. Missing assets return 404.

Hashed application assets cache for one year; audio and FFmpeg resources cache for one day, while the bank manifest revalidates. The current bank fits Static Assets, so this deployment needs no R2 bucket.

FFmpeg's single-thread core is larger than Cloudflare's per-asset limit. `scripts/prepare-ffmpeg.mjs` compresses the pinned npm core with gzip and splits it into pieces no larger than 8 MiB during installation/build. The browser verifies SHA-256 hashes and decompresses the module locally with `DecompressionStream`; use a modern browser. Generated core assets are ignored by Git and included in deployment output. Release archives and checksums accompany the deployment package.

## Overture

The Release includes `overture.json`, `overture.tar.gz` and `SHA256SUMS`, following the current [Overture schema](https://github.com/lsy-404/overture/blob/main/docs/RECIPE.md).

Open your Overture deployment with `?src=lsy-404/CASSIE`, select a release and your Cloudflare account, then choose a Worker name and optional custom domain. The package declares no storage resources or app secrets. Its small deployment entry only forwards to the static assets binding. Ordinary Wrangler deployment uses assets alone.

Build the package with `npm run package:overture`. The packager checks the supported Overture version's 64 MiB asset budget, 24 MiB archive budget and 20,000-entry archive budget. FFmpeg remains compressed inside the package and is decompressed only in the visitor's browser.

## Licensing and sources

Program code is **AGPL-3.0-only**, see [LICENSE](LICENSE). The supplied SCP:SL voice recordings and their compressed adaptations retain **CC BY-SA 3.0**, with attribution and extraction provenance in `data/` and the served license page. Third-party packages retain their own licenses. No game executable or proprietary game source is included.

Source code and complete build instructions are available in this repository. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for decoder and FFmpeg source locations and licenses.
