# Resource extraction

Use Python 3.11 or newer and install the pinned extraction dependencies:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r scripts\requirements-extract.txt
.venv\Scripts\python scripts\extract_cassie.py --game-root "E:\Steam\steamapps\common\SCP Secret Laboratory"
```

The extractor reads the installed Unity serialized assets, decodes selected AudioClips, and encodes complete clips as mono 48 kHz Ogg Opus at 48 kbit/s VBR. It does not trim source samples. It writes `public/audio`, `public/bank.json`, and `data/source-manifest.json`; the latter records source hashes, stable Unity object IDs, durations, and exported-file hashes. It copies the installed license text to `data/licenses/scpsl-license.txt`.

The word selection uses the mono, word-like AudioClip names in `SCPSL_Data/sharedassets1.assets` and `sharedassets2.assets`, with explicit exclusions for known non-speech clips and one phrase allowlist entry for a CASSIE announcement. The installed IL2CPP data exposes no canonical public wordbank table; the source manifest records this selection limitation. The directly named `CASSIE-background-std` asset is included as an effect. `bell_start` and `bell_end` are excluded because serialized references do not establish them as CASSIE announcement cues. `Beep_Start` references `Gram Detector` objects. The manifest records start and end cue IDs as unavailable until source evidence identifies them.

## Interior phoneme windows

Install the pinned aligner into the ignored work directory, then build the derived phone-window index from the checked-in Opus bank:

```powershell
npm install --prefix work\phoneme-tools --no-save echogarden@3.4.0
node scripts\build-phonemes.mjs
```

The builder uses Echogarden's English eSpeak-reference DTW path and its nested word/token/phone timeline. It records only measured phone intervals inside words, drops each word's first and last phone, and ignores windows shorter than 20 ms. Each selected interval retains its source clip ID, source SHA-256, raw IPA label, and timestamps. IPA lookup keys remove only a leading or trailing stress marker; the exact aligned label remains in each entry. Failures are recorded in `public/phonemes.json` and `data/phonemes-manifest.json`; no equal-duration boundaries are synthesized. The aligner package is a build-time tool and is not included in the browser bundle.
