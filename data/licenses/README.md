# CASSIE audio attribution

The extracted CASSIE speech and background audio is from SCP: Secret Laboratory by Northwood Studios. The installed game's `license.txt` identifies the general work as licensed under Creative Commons Attribution-ShareAlike 3.0 International (CC BY-SA 3.0) and lists exceptions; it does not list the CASSIE audio among those exceptions. This repository therefore attributes the source to Northwood Studios and provides the license text as evidence. The license terms apply to redistributed adapted audio as described by CC BY-SA 3.0.

- Source: SCP: Secret Laboratory, installed game build 24956965.
- License: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- Evidence: [scpsl-license.txt](scpsl-license.txt), copied from the installed game directory.
- CASSIE behavior reference: [Official SCP: Secret Laboratory Wiki: C.A.S.S.I.E.](https://en.scpslgame.com/index.php?title=C.A.S.S.I.E.).

- Legal code: [CC-BY-SA-3.0.txt](CC-BY-SA-3.0.txt), the plain-text legal code of CC BY-SA 3.0 Unported from https://creativecommons.org/licenses/by-sa/3.0/legalcode.txt , retrieved 2026-10-06 (sha256 `3f941b3b89cf7b8370ceb83cc76d2120d471b58735d8ca60238a751a48d7f72f`), unmodified. An identical copy is served as `public/licenses/CC-BY-SA-3.0.txt`.
- Notice shipped with the audio: [public/audio/LICENSE.txt](../../public/audio/LICENSE.txt).
- Caveat: the game's license file states the work is licensed under "Creative Commons Attribution-ShareAlike 3.0 International" but links the 3.0 Unported legal code, and it states that the remaining source code is all rights reserved. The exceptions list does not name the CASSIE audio, which is why CC BY-SA 3.0 is applied to it, but the file does not enumerate the audio assets explicitly.

# Site icon attribution

The tab icon (`public/favicon.svg`, `public/favicon.ico`, `public/apple-touch-icon.png`) is derived from the SCP Foundation emblem.

- Source: [SCP Foundation (emblem).svg](https://commons.wikimedia.org/wiki/File:SCP_Foundation_(emblem).svg), Wikimedia Commons, retrieved 2026-10-06 (original SVG sha256 `345207fc14b21c9237b0abc0ca1a5ea0481c02098c0645cbaf6313341f2d9122`).
- Author: the original SCP logo was designed by far2; the first high-resolution PNG version was made by Aelanna. The Commons file page credits the SCP Wiki as source.
- License: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), as stated on the Commons file page, which also carries a simple-shape public-domain tag. CC BY-SA 3.0 is applied here as the more restrictive of the two.
- Changes: recoloured white on a dark rounded square, ring, outline and arrow strokes thickened, rasterized to ICO and PNG with `node scripts/build-icons.mjs`.
- The icon is under its own license, separate from the project's AGPL-3.0-only program code.
