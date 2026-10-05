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

Use words from the supplied bank, separated by spaces. Unrecognized words are reported and skipped. This is recorded-word synthesis, so arbitrary text cannot be pronounced. Numbers are expanded into speech units where available.

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

## Cloudflare deployment

```sh
npm run deploy:check
npm run deploy
```

`wrangler.jsonc` deploys **Workers Static Assets** to the configured account and custom domain. There is no server script, database, runtime API, or server-side audio processing. For your own deployment, change the account ID and domain first. Missing assets return 404.

FFmpeg's single-thread core is larger than Cloudflare's per-asset limit. `scripts/prepare-ffmpeg.mjs` splits the pinned npm core into 8 MiB pieces during installation/build. The browser verifies SHA-256 hashes and reconstructs the module locally. Generated core assets are ignored by Git and included in deployment output. A Release deployment archive can be extracted and served without rebuilding; its checksums accompany the archive.

## Licensing and sources

Program code is **AGPL-3.0-only**, see [LICENSE](LICENSE). The supplied SCP:SL voice recordings and their compressed adaptations retain **CC BY-SA 3.0**, with attribution and extraction provenance in `data/` and the served license page. Third-party packages retain their own licenses. No game executable or proprietary game source is included.

Source code and complete build instructions are available in this repository. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for decoder and FFmpeg source locations and licenses.
