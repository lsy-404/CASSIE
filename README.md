# CASSIE

A CASSIE announcement studio for [SCP: Secret Laboratory](https://scpslgame.com/), running entirely in your browser. Edit an announcement, adjust playback, listen with synchronized text highlighting, and download WAV or Opus audio.

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

Use words from the supplied bank, separated by spaces. Numbers are expanded into speech units where available. The Fluent toolbar inserts slash commands that simplify the game's modifier behavior. Rendering updates as you edit; turn off the live-render checkbox to render manually. The audio bar supports seeking, with current words and spaces highlighted in the announcement.

| Modifier | Meaning |
| --- | --- |
| `/pitch:1.2` | Set subsequent playback speed and pitch |
| `/volume:0.7` | Set subsequent voice volume |
| `/offset:0.1` | Skip the beginning of the next clip |
| `/duration:0.3` | Limit the next clip's duration |
| `/pause:0.5` | Insert half a second of silence |
| `/spacing:0.2` | Start the next clip this many seconds after the previous start; overlap is possible |
| `/stutter:0.3:0.1:3` | Repeat a section of the next clip |
| `/clip:id` | Insert a supplied recording by its clip ID |
| `/start`, `/end` | Insert the announcement boundary cues |

The parser implements a simplified command syntax based on the [documented modern CASSIE behavior](https://en.scpslgame.com/index.php?title=Updates/14.2.3). Commands use a leading slash; phonemes use a pair of slashes. The renderer has bounded duration and token counts. It does not reproduce the game's announcement queue.

Exact phrase recordings take priority. Article variants use the following written initial, so pronunciation exceptions may differ from the game.

`/clip:id` explicitly inserts any supplied clip, including effects and internal fragments. Clip IDs and provenance are listed in `public/bank.json`.

Single-letter text is pronounced as English text: `a` is the article and `I` is the pronoun. The game's NATO alphabet recordings remain available explicitly, for example `/clip:a` for Alpha and `/clip:i` for India.

## Phoneme composition

Type space-separated phones between slashes, for example `/ a e: /`, or enter IPA such as `/ h ə l oʊ /`. Direct phoneme blocks work without enabling English word expansion. The interface lists the available measured phones and reports missing units.

The shortcuts `a` and `e` select `ɑː` and `ɛ`. A trailing `:` requests a long vowel: a matching recorded long vowel is used when available; otherwise the vowel's middle portion is repeated with crossfades while preserving its pitch. IPA `j` remains the palatal glide; use `jh` for `dʒ`. Long-vowel repetition can sound rough.

Unrecorded English words automatically use eSpeak's US English pronunciation through `phonemizer`. Existing word and phrase recordings take priority. Pronunciation conversion and composition run locally; missing phones cause the whole unrecorded word to be skipped with a warning.

Underlines distinguish original recordings (green), composed words or phones (yellow), approximate or unavailable audio (red), and recognized slash commands (blue). Missing long vowels can be stretched from verified short-vowel windows; supported allophone substitutions keep the word playable with a red advisory underline. Words absent from both local US and British English Hunspell dictionaries use a red wavy underline and still synthesize. Dictionary hints can flag proper names or specialized vocabulary. Playback highlights the current word or intervening space using the rendered audio timeline.

Echogarden's synthesis-reference MFCC/DTW alignment estimates phoneme boundaries from the actual audio, including the beginnings and endings of source words. Selection first favors the target word position, then neighboring phones and continuous source windows, with duration used to break ties. The renderer joins measured windows with short crossfades. These automatically aligned fragments can sound rough; pronunciation and transitions remain experimental.

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
