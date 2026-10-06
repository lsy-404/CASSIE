# CASSIE PLUS

CASSIE PLUS is a CASSIE announcement studio for [SCP: Secret Laboratory](https://scpslgame.com/), running entirely in your browser. Edit an announcement, adjust playback, listen with synchronized text highlighting, and download WAV or Opus audio.

**Site:** https://cassie.leisiyu.dev

Vue and [platform-kit Fluent](https://github.com/lsy-404/platform-kit) provide the interface. A dedicated Web Worker decodes the supplied Opus clips through `ogg-opus-decoder` WebAssembly and mixes the announcement. FFmpeg WASM loads only for Opus export. Text and rendered audio stay on your device.

The interface supports Chinese and English, initially follows the browser language, and remembers the selected language. The terminal entry checks real module workers and the audio WebAssembly engines before the studio opens automatically. A failed check stops the boot log in place: the failing step is marked `[FAIL]` and `[ERROR]` lines give the step, the browser environment and the reason. Use a standard Chromium browser with full support for the required browser APIs.

The terminal layout references the game's [official CASSIE monitor](https://en.scpslgame.com/index.php?title=File:LCZ_Screen_CASSIE_Scan_Complete.png). Its editable default is an original SCP recruitment broadcast with markup examples. One long playback bar also shows rendering progress, supports already-rendered audio and updates the current time from the media clock. The ribbon provides WAV and Opus downloads.

## Interface

The studio is laid out like an editor: a title bar, a Word-style ribbon, an activity bar with a collapsible side bar, the announcement editor with a line-number gutter and token highlighting, a bottom panel (Player and Analysis) and a status bar. The theme is the Fluent dark scheme with a white accent and neutral greys; the Fluent token overrides live in `src/theme.css`, while the shared diamond slider thumb and scrollbar styling are in `src/style.css`.

- The ribbon is a single flat page: `src/ribbon.ts` lists groups and commands (buttons and number fields; label, icon, enabled predicate, action id) and one generic `Ribbon.vue` renders every group side by side, each with its caption. It holds rendering, the live toggle, WAV and Opus export, tags, reading time and the advanced `<sync>` insertion. Use the chevron at its right end or `Ctrl+F1` to hide it; a slim strip brings it back. Adding a command is one entry in that table, one handler in `src/studio.ts` (the action table is checked against the `ActionId` union at compile time) and label and tip keys in both locales in `src/i18n.ts`; a new tag also needs an entry in `src/markup.ts`.
- `src/studio.ts` holds the shared state and actions (text, options, render and export lifecycle, analysis, editor insertion) and is provided to the components under `src/components`.
- The side bar shows Settings (open by default on desktop), the phoneme inventory, or Help. Settings holds the global mix (game pitch, volume, word gap, speech rate), the voice post-processing sliders and the Unrecorded words switch; Help lists every tag, the shortcuts and the colour legend. The legend covers the editor token colours (blue command, green recorded, yellow synthesized, red cannot synthesize, wavy underline = has a fix, dashed = blocked by strict mode) and the player timeline colours. The panel header carries the panel toggle. All sliders share one diamond thumb defined in `src/style.css`.
- The Analysis tab lists every analysis notice with an error, warning or info icon, filterable by severity, with counts on the tab; selecting one moves the editor cursor to its source. Info entries include each word synthesized from phonemes. Render warnings appear there too.
- The player timeline reuses the editor colours: recorded words green, synthesized words yellow, cues and effects light grey, gaps transparent; the played part is drawn brighter and the shared diamond thumb is the only marker. `<sync>` tracks appear as thin extra lanes under the main lane, shared by blocks that never overlap.
- Shortcuts: `/` focuses the editor, `Ctrl/Cmd+Enter` renders, `Ctrl/Cmd+B` toggles the side bar.
- Below 820 px the side bar becomes an overlay, closed by default (`Esc` closes it) and the ribbon scrolls horizontally with edge buttons.

## Development

Use Node.js 22.12+ and pnpm 10.32.1:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm test:browser
```

Install the browser once with `pnpm exec playwright install chromium` before browser tests. Tests live in `test/`.

## Announcement syntax

Type complete English words directly. Numbers expand into speech units where available. You can type the tags yourself or insert them from the ribbon. Rendering updates as you edit; turn off the live-render toggle in the ribbon to render manually. The audio bar supports seeking, with current words and spaces highlighted in the announcement.

| Modifier | Meaning |
| --- | --- |
| `<pitch value="1.2">text</pitch>` | Set speed and pitch for enclosed speech |
| `<rate value="1.2">text</rate>` | Set speech rate without changing pitch, gaps or cues |
| `<fit seconds="2">text</fit>` | Time-stretch enclosed speech to finish in 0.05–120 seconds, overriding the speech rate |
| `<voice pitch="3" loudness="-2.5" tension="0.25" breathiness="0.3" formant="-2">text</voice>` | Adjust pitch, loudness, tension, breathiness and resonance for enclosed speech |
| `<volume value="0.7">text</volume>` | Set volume for enclosed speech |
| `<sync>text</sync>` | Play enclosed speech on a temporary extra track that starts where the next word would start, for harmony, echo or backing voices; the main track does not advance by it |
| `<stutter repeats="3" length="0.1" position="0">text</stutter>` | Loop a short slice of each enclosed word like a skipping record: the slice is repeated three extra times with no gap; `length` (0.02–1 s, default 0.08) and `position` (0–1 of the word, default 0) are optional |
| `<offset seconds="0.1">text</offset>` | Skip the start of enclosed speech |
| `<duration seconds="0.3">text</duration>` | Limit the duration of enclosed speech |
| `<spacing seconds="0.2">text</spacing>` | Set the enclosed speech's start spacing |
| `<pause seconds="0.5"/>` | Insert half a second of silence |
| `<br>` or `<br/>` | Insert half a second of silence |
| `<clip id="id"/>` | Insert a supplied recording by its clip ID |
| `<start>`, `<end>` | Insert the announcement boundary cues |

The standalone markers `start`, `end`, `pause`, `clip`, and `br` also accept a trailing slash, such as `<start/>`. They do not need closing tags. The initial editable announcement demonstrates the common effect tags, including `<fit>`.

Effects end at their closing tag. Tags can nest; closing an inner tag restores the enclosing parameters. For example, `<pitch value="1.2">attention</pitch> personnel` changes only `attention`. You can put tags inside a word, such as `me<pitch value="1.2">tri</pitch>cs`. The complete word is pronounced first, and phonemized spelling prefixes locate the nearest phone boundaries for its effects; the measured phone fragments join without a word gap. Such boundaries are approximate and receive a red advisory. Opening and closing tags remain visible in the editor and are never rendered as HTML.

The effects simplify the [documented modern CASSIE behavior](https://en.scpslgame.com/index.php?title=Updates/14.2.3). Slash pairs are reserved for direct phonemes. Invalid, unknown, mismatched, or unclosed tags produce red error marks and a warning. The renderer has bounded duration and token counts and does not reproduce the game's announcement queue. Ambient facility mixing has been removed.

A `<sync>` block starts where the next item after the preceding one would start, using the same gap and spacing rules, so `X <sync>Y</sync> Z` makes Y and Z start together when Z is a word; before a pause or cue Y starts one word gap later. After `</sync>` the main track continues from where it was, and the total length is that of the longest track. Pitch, volume, rate and voice are inherited and every scoped tag works inside, including nested `<sync>` blocks, which anchor at their parent track. A `<fit>` group measures only the track it was opened on, so sync content inside it follows the derived rate but does not count toward the duration. Sync tracks mix additively with the main track.

A `<stutter>` loops one slice of every word inside it: starting `position` of the way into the word, `length` seconds are inserted `repeats` extra times in place, joined with a few-millisecond crossfade and without a gap, so the word becomes longer by `length × repeats`. The slice is clamped to what remains of the word; cues, pauses and effects are not stuttered, and a multi-word phrase recording is stuttered once, at its start. `position` counts into the audio left after `<offset>` and `<duration>` cropping, and the loop is added afterwards, so stuttered speech can run past a `<duration>` limit. Stutter is applied before speech rate, fit and voice processing. It also works inside a word, where only the enclosed fragment supplies the slice: `me<stutter repeats="3">tri</stutter>cs`.

Examples of `<stutter>`:

- Word-start stutter: `<stutter repeats="2" length="0.1">attention</stutter>` sounds like `at-at-attention`.
- Mid-word loop: `me<stutter repeats="3">tri</stutter>cs` loops the start of `tri`.

Examples of `<sync>`:

- Harmony: `<sync><voice pitch="4">contain</voice></sync> contain` sings `contain` twice at once, one voice four semitones higher.
- Echo: `<sync><volume value="0.5"><pause seconds="0.15"/>contain</volume></sync> contain` repeats a quieter `contain` a moment later on the extra track.
- Call and response: `<voice pitch="-3">Is it open?</voice> <sync><voice pitch="4">It is open.</voice></sync> <pause seconds="1"/>` answers the question on its own track while the main track waits.

Inside `<fit>`, the rate is derived so the enclosed words and the gaps between them take the requested time; gaps, pauses and cues keep their length and count toward it. The derived rate is limited to 0.25–4× and a warning states the closest achievable duration when the limit applies. Content outside the tag is unaffected, and the audio added by a stutter inside a fit group counts toward its duration. Speech rate defaults to 1×. The global control and scoped rate each accept 0.5–2× and multiply when combined. Speech uses pitch-preserving time stretching; word gaps, measured gaps inside phrase recordings, explicit pauses, and effect clips including announcement boundary cues keep their duration.

Voice post-processing uses [WORLD](https://github.com/mmorise/World) compiled to WebAssembly in the audio worker. Pitch accepts −12 to +12 semitones; loudness accepts −24 to +12 dB; tension accepts −1 to +1; breathiness accepts 0–1; formant accepts −6 to +6 semitones. The Fluent sliders and numeric fields allow fine adjustments. Scoped attributes override the corresponding global or enclosing voice setting, and closing the tag restores it. Omitted attributes inherit. `<pitch>` remains the game's combined speed/pitch effect; `<voice pitch="3">` raises pitch while keeping speech duration fixed.

All five voice settings default to zero, preserving the original audio. Loudness alone scales PCM without vocoder resynthesis. Positive gain is limited by the speech segment's peak headroom; overlapping layers retain the mixer's sample clamp. Other active settings resynthesize speech from its fundamental frequency, spectral envelope and aperiodicity. Tension applies a voiced spectral tilt of up to ±3 dB per octave around 1 kHz: lower is softer, higher is brighter. Breathiness increases nonperiodic energy in voiced frames. These are vocoder timbre controls, not a trained DiffSinger or physiological voice model. Gaps, pauses and special clips retain their original samples. Each vocoder-processed speech block is limited to 20 seconds before speech-rate stretching. Extreme settings and very short phoneme fragments can sound less natural.

Exact phrase recordings take priority. Article variants use the following written initial, so pronunciation exceptions may differ from the game.

`<clip id="id"/>` explicitly inserts a supplied clip, including effects and internal fragments. Clip IDs and provenance are listed in `public/bank.json`.

Recorded words match regardless of capitalization, including `CASSIE` and `Attention`. Unrecorded all-uppercase acronyms, such as `ROC` and `AUC`, and standalone uppercase letters use English letter names. A standalone `I` remains the pronoun, lowercase `a` is the article, and uppercase `A` is the letter name. The game's NATO alphabet recordings remain available explicitly, for example `<clip id="a"/>` for Alpha and `<clip id="i"/>` for India.

## Phoneme composition

Type space-separated phones between slashes, for example `/ a e: /`, or enter IPA such as `/ h ə l oʊ /`. Direct phoneme blocks work without enabling English word expansion. The interface lists the available measured phones and reports missing units. Clicking a phone inside an existing block inserts only that phone; outside a block it inserts a new slash pair.

The shortcuts `a` and `e` select `ɑː` and `ɛ`. A trailing `:` requests a long vowel: a matching recorded long vowel is used when available; otherwise the vowel's middle portion is repeated with crossfades while preserving its pitch. IPA `j` remains the palatal glide; use `jh` for `dʒ`. Long-vowel repetition can sound rough.

The Unrecorded words switch in the Settings view (on by default, stored as `options.phonemes` in the URL data) chooses between synthesizing unrecorded English words and strict mode. In strict mode only recorded words are spoken; words that could have been synthesized stay silent, appear as dashed yellow tokens and are listed as warnings in the Analysis tab. With the toggle on, unrecorded English words automatically use eSpeak's US English pronunciation through `phonemizer`. Existing word and phrase recordings take priority. Pronunciation conversion and composition run locally; missing phones cause the whole unrecorded word to be skipped with a warning.

Underlines distinguish recognized commands and tags (blue), original recordings (green), composed words or phones (yellow) and text that cannot be synthesized (red). A wavy underline in the token's own colour means a fix is suggested, either by the analysis or by the spelling checker, and the tooltip shows the replacement; words absent from both local US and British English Hunspell dictionaries are yellow and wavy and still synthesize. Synthesizable words skipped in strict mode are yellow and dashed. Missing long vowels can be stretched from verified short-vowel windows; supported allophone substitutions keep the word playable with an advisory warning. Playback highlights the current word or intervening space using the rendered audio timeline.

Echogarden's synthesis-reference MFCC/DTW alignment estimates phoneme boundaries from the actual audio, including the beginnings and endings of source words. Selection first favors the target word position, then neighboring phones and continuous source windows, with duration used to break ties. The renderer joins measured windows with short crossfades. These automatically aligned fragments can sound rough; pronunciation and transitions remain experimental.

Generation code, timestamp selection and composition code are AGPL-3.0-only. The original and excerpted game audio retain CC BY-SA 3.0. Reproduce the timestamp index using `scripts/build-phonemes.mjs`; the source and output hashes are in `data/phonemes-manifest.json`.

## URL loading and direct export

`?data=<base64url>` preloads a UTF-8 JSON object containing `text`, optional `options`, optional `locale` (`zh` or `en`), and within `options` an optional `phonemes` boolean (default `true`; `false` selects strict mode). `&export=wav` or `&export=opus` renders and downloads the supplied announcement once after the startup checks. An export requires valid `data`; invalid input produces an input error and never exports the default example. Importing does not play audio automatically.

```js
const payload = {
  text: '<start>Attention all personnel<end>',
  locale: 'en',
  options: {
    rate: 1.13,
    voice: { loudnessDb: -2.5, tension: 0.25, breathiness: 0.1 },
  },
};
const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const url = `https://cassie.leisiyu.dev/?data=${data}&export=wav`;
```

This example uses Node.js. In browser code, encode the JSON with `TextEncoder` before base64 conversion. Standard padded base64 is also accepted when URL-encoded. Text is limited to 16 KiB and decoded JSON to 64 KiB. Unknown fields, duplicate parameters and out-of-range values are rejected. Omitted options use normal studio defaults. Base64 is an encoding, so the announcement remains readable by anyone who receives the URL.

Supported option keys are `pitch` (0.65–1.35), `volume` (0–1), `gap` (0–0.8 seconds), `rate` (0.5–2), and `voice`. Voice keys are `pitchSemitones`, `loudnessDb`, `tension`, `breathiness`, and `formantSemitones`, with the ranges given above. The `<voice>` tag uses `pitch`, `loudness`, and `formant` for the corresponding scoped fields.

## Cloudflare deployment

```sh
pnpm deploy:check
pnpm run deploy
```

`wrangler.jsonc` deploys **Workers Static Assets** to the configured account and custom domain. There is no server script, database, runtime API, or server-side audio processing. For your own deployment, change the account ID and domain first. Missing assets return 404.

Hashed application assets cache for one year; audio and FFmpeg resources cache for one day, while the bank manifest revalidates. The current bank fits Static Assets, so this deployment needs no R2 bucket.

FFmpeg's single-thread core is larger than Cloudflare's per-asset limit. `scripts/prepare-ffmpeg.mjs` compresses the pinned npm core with gzip and splits it into pieces no larger than 8 MiB during installation/build. The browser verifies SHA-256 hashes and decompresses the module locally with `DecompressionStream`; use a modern browser. Generated core assets are ignored by Git and included in deployment output. Release archives and checksums accompany the deployment package.

## Overture

The Release includes `overture.json`, `overture.tar.gz` and `SHA256SUMS`, following the current [Overture schema](https://github.com/lsy-404/overture/blob/main/docs/RECIPE.md).

Open your Overture deployment with `?src=lsy-404/CASSIE`, select a release and your Cloudflare account, then choose a Worker name and optional custom domain. The package declares no storage resources or app secrets. Its small deployment entry only forwards to the static assets binding. Ordinary Wrangler deployment uses assets alone.

Build the package with `pnpm package:overture`. The packager checks the supported Overture version's 64 MiB asset budget, 24 MiB archive budget and 20,000-entry archive budget. FFmpeg remains compressed inside the package and is decompressed only in the visitor's browser.

## Licensing and sources

Program code is **AGPL-3.0-only**, see [LICENSE](LICENSE). The supplied SCP:SL voice recordings and their compressed adaptations retain **CC BY-SA 3.0**, with attribution and extraction provenance in `data/` and the served license page. Third-party packages retain their own licenses. No game executable or proprietary game source is included.

Source code and complete build instructions are available in this repository. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for decoder and FFmpeg source locations and licenses.

## Acknowledgements

Thanks to [this video](https://www.bilibili.com/video/BV1vt8G6qEeg). CASSIE PLUS is developed entirely independently: it does not reference that video, involves no cooperation with it, and has no affiliation or subordination to the video, its author or related works.
