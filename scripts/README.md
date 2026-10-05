# Resource extraction

Use Python 3.11 or newer and install the pinned extraction dependencies:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r scripts\requirements-extract.txt
.venv\Scripts\python scripts\extract_cassie.py --game-root "E:\Steam\steamapps\common\SCP Secret Laboratory"
```

The extractor reads the installed Unity serialized assets, decodes selected AudioClips, and encodes complete clips as mono 48 kHz Ogg Opus at 48 kbit/s VBR. It does not trim source samples. It writes `public/audio`, `public/bank.json`, and `data/source-manifest.json`; the latter records source hashes, stable Unity object IDs, durations, and exported-file hashes. It copies the installed license text to `data/licenses/scpsl-license.txt`.

To rebuild only the derived broadcast cue excerpts without re-encoding the speech bank, pass `--cues-only`.

The word selection uses the mono, word-like AudioClip names in `SCPSL_Data/sharedassets1.assets` and `sharedassets2.assets`, with explicit exclusions for known non-speech clips and one phrase allowlist entry for a CASSIE announcement. The installed IL2CPP data exposes no canonical public wordbank table; the source manifest records this selection limitation. The directly named `CASSIE-background-std` asset remains available as a background effect. Source references and `CassieBackgroundPlayer` scheduling constants support two additional boundary excerpts: `cassie-start` uses source samples from 0 through 2.5 seconds, and `cassie-end` uses 29.1 seconds through the complete source tail. Both excerpts come from the same 39.4286-second stereo AudioClip referenced by the serialized starting and ending AudioSources on the `Background Player` GameObject. These standalone excerpts preserve the exact source windows but do not recreate runtime queueing or AudioSource crossfades. `bell_start` and `bell_end` remain excluded; `Beep_Start` references `Gram Detector` objects.

## Phoneme windows and phrase word timings

Install the pinned aligner into the ignored work directory, then build the derived phone-window index from the checked-in Opus bank:

```powershell
npm install --prefix work\phoneme-tools --no-save echogarden@3.4.0
node scripts\build-phonemes.mjs
```

The builder uses Echogarden's English eSpeak-reference DTW path and its nested word/token/phone timeline. Schema version 2 retains measured first, middle, and last phone intervals of each word, with phone position and adjacent IPA labels; windows shorter than 20 ms or outside the source clip are omitted. Multiword clips also retain Echogarden's measured word intervals in `wordTimings`, only when every aligned word has a valid interval. All timestamps are seconds relative to the source clip. IPA lookup keys remove a leading or trailing stress marker, while each unit retains its original IPA label, source clip ID, source SHA-256, and timestamps. Alignment timelines are cached under ignored `work/phoneme-alignments` by clip hash and transcript. Failures are recorded in `public/phonemes.json` and `data/phonemes-manifest.json`; no equal-duration boundaries are synthesized. The aligner package is a build-time tool and is not included in the browser bundle.
