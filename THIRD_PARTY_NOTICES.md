# Third-party notices

| Component | License | Source |
| --- | --- | --- |
| platform-kit Fluent 0.2.6 | Apache-2.0 | https://github.com/lsy-404/platform-kit/tree/fluent-v0.2.6 |
| Vue 3.5.43 | MIT | https://github.com/vuejs/core/tree/v3.5.43 |
| htmlparser2 12.0.0, dom-serializer, domelementtype, domhandler, domutils and entities | MIT AND BSD-2-Clause | https://github.com/fb55/htmlparser2 |
| ogg-opus-decoder 1.7.5 and Opus decoder/common modules | MIT | https://github.com/eshaz/wasm-audio-decoders |
| codec-parser | LGPL-3.0 | https://github.com/eshaz/codec-parser |
| libopus | BSD-3-Clause | https://opus-codec.org/license/ |
| ffmpeg.wasm wrapper 0.12.15 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| ffmpeg.wasm core 0.12.10 | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10 |
| phonemizer.js 1.2.1 wrapper | Apache-2.0 | https://github.com/xenova/phonemizer.js |
| eSpeak NG pronunciation engine and data | GPL-3.0-or-later | https://github.com/espeak-ng/espeak-ng |
| Echogarden 3.4.0 offline alignment | MIT AND GPL-3.0-or-later | https://github.com/echogarden-project/echogarden |
| nspell 2.1.5 and is-buffer | MIT | https://github.com/wooorm/nspell |
| dictionary-en 4.0.0 Hunspell data | MIT AND BSD | https://github.com/wooorm/dictionaries/tree/main/dictionaries/en |
| dictionary-en-gb 3.0.0 Hunspell data | MIT AND BSD | https://github.com/wooorm/dictionaries/tree/main/dictionaries/en-GB |

The FFmpeg core is used unmodified from the pinned npm package. Its source, library build recipes and build configuration are maintained in the linked upstream repository. The core's constituent libraries retain their respective licenses; upstream licensing and source details: https://ffmpegwasm.netlify.app/docs/overview/ .

The WebAssembly decoder's distributed bundle retains its original copyright notices. MIT metadata and source are available in the locked npm packages and linked upstream repository. Runtime library license texts are served under `public/licenses/`.

The pinned phonemizer package embeds the eSpeak NG engine and English pronunciation data. Its wrapper source and embedded engine are available in the linked upstream repository. Echogarden is used only to prepare the phoneme timestamps, and is not shipped as a browser dependency. Reproduction commands are in `scripts/README.md`.

SCP: Secret Laboratory audio: Northwood Studios and credited contributors, https://scpslgame.com/ . Original recordings extracted from the locally installed game; derived Ogg Opus copies are distributed under CC BY-SA 3.0 as specified by the installed `license.txt`. Extraction and encoding details are recorded in `data/`. This project is an independent fan tool.
