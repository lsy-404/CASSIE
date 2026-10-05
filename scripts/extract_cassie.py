#!/usr/bin/env python3
"""Extract the installed CASSIE speech bank and encode browser-ready Opus clips."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import UnityPy
from UnityPy.export.AudioClipConverter import extract_audioclip_samples

SOURCE_ASSETS = (Path("SCPSL_Data/sharedassets1.assets"), Path("SCPSL_Data/sharedassets2.assets"))
SOURCE_RESOURCES = (Path("SCPSL_Data/sharedassets1.resource"), Path("SCPSL_Data/sharedassets2.resource"))
LICENSE_FILE = Path("license.txt")
WORD_PATTERN = re.compile(r"^[A-Za-z0-9_-]+(?:[ '-][A-Za-z0-9_-]+)*$")

# These are non-speech mono clips interleaved in the same Unity asset file.
NON_CASSIE_NAMES = {
    "127 Box Ambient Closed",
    "127 Box Ambient Open",
    "127 Box Close",
    "127 Box Open",
    "ElevatorMoving",
    "MegaPatch2_01",
    "Waterfall L",
    "Waterfall Muffled",
    "Waterfall Pit",
    "Waterfall r",
    "xmas_bouncyballs",
    "xmas_jinglebells",
    "Beep_Start",
    "Ambient*",
    "EZ Zoom Loop",
    "hit",
}
# These complete phrase clips are part of known CASSIE announcements, but their
# punctuation prevents the normal word-name matcher from accepting them.
CASSIE_PHRASES = {
    "All remaining personnel (...)"
}
EFFECT_NAMES = {"CASSIE-background-std"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clip_id(name: str) -> str:
    if name == "All remaining personnel (...)":
        return "all-remaining-personnel"
    value = re.sub(r"[^a-z0-9_-]+", "-", name.casefold())
    value = re.sub(r"-{2,}", "-", value)
    if not value or value in {".", ".."}:
        raise ValueError(f"Cannot make a safe clip id from {name!r}")
    return value


def selected(name: str, channels: int) -> str | None:
    if name in EFFECT_NAMES:
        return "effect" if channels == 2 else None
    if channels != 1 or name in NON_CASSIE_NAMES or name.casefold().startswith("ambient"):
        return None
    if WORD_PATTERN.fullmatch(name):
        return "word"
    if name in CASSIE_PHRASES:
        return "word"
    return None


def encode_opus(wav: bytes, ffmpeg: str) -> bytes:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "wav",
        "-i",
        "pipe:0",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        "-vbr",
        "on",
        "-application",
        "audio",
        "-flags:a",
        "+bitexact",
        "-fflags",
        "+bitexact",
        "-f",
        "ogg",
        "pipe:1",
    ]
    result = subprocess.run(command, input=wav, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    if not result.stdout.startswith(b"OggS"):
        raise RuntimeError("Encoder output is not an Ogg stream")
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True, help="Installed SCP: Secret Laboratory directory")
    parser.add_argument("--output-root", type=Path, default=Path(__file__).resolve().parents[1], help="CASSIE repository root")
    args = parser.parse_args()

    game_root = args.game_root.resolve()
    output_root = args.output_root.resolve()
    asset_paths = [game_root / rel for rel in SOURCE_ASSETS]
    resource_paths = [game_root / rel for rel in SOURCE_RESOURCES]
    license_path = game_root / LICENSE_FILE
    for required in (*asset_paths, *resource_paths, license_path):
        if not required.is_file():
            parser.error(f"Required installed-game file is missing: {required}")

    audio_objects = []
    for asset_path, source_asset in zip(asset_paths, SOURCE_ASSETS):
        env = UnityPy.load(str(asset_path))
        for obj in env.objects:
            if obj.type.name != "AudioClip":
                continue
            audio = obj.read()
            kind = selected(audio.m_Name, audio.m_Channels or 0)
            if kind:
                audio_objects.append((obj, audio, kind, source_asset))

    ids = [clip_id(audio.m_Name) for _, audio, _, _ in audio_objects]
    if len(ids) != len(set(ids)):
        raise RuntimeError("Selected CASSIE names collide after conversion to browser IDs")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    audio_dir = output_root / "public" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    clips = []
    for index, (obj, audio, kind, source_asset) in enumerate(sorted(audio_objects, key=lambda row: clip_id(row[1].m_Name)), start=1):
        samples = extract_audioclip_samples(audio)
        if len(samples) != 1:
            raise RuntimeError(f"Unexpected multiple streams for {audio.m_Name!r}")
        wav_name, wav = next(iter(samples.items()))
        if not wav.startswith(b"RIFF"):
            raise RuntimeError(f"UnityPy did not produce WAV for {audio.m_Name!r}: {wav_name}")
        opus = encode_opus(wav, ffmpeg)
        cid = clip_id(audio.m_Name)
        filename = f"{cid}.opus"
        (audio_dir / filename).write_bytes(opus)
        clips.append(
            {
                "id": cid,
                "file": f"/audio/{filename}",
                "duration": round(float(audio.m_Length), 6),
                "kind": kind,
                "sourceName": audio.m_Name,
                "sourceContainer": source_asset.as_posix(),
                "sourcePathId": int(obj.path_id),
                "sourceFrequency": int(audio.m_Frequency or 0),
                "sourceChannels": int(audio.m_Channels or 0),
                "decodedWavSha256": sha256(wav),
                "sha256": sha256(opus),
            }
        )
        if index % 100 == 0 or index == len(audio_objects):
            print(f"Encoded {index}/{len(audio_objects)} clips", file=sys.stderr)

    steam_manifest = game_root.parent.parent / "appmanifest_700330.acf"
    build_match = re.search(r'"buildid"\s+"(\d+)"', steam_manifest.read_text(encoding="utf-8", errors="replace")) if steam_manifest.is_file() else None
    build_id = build_match.group(1) if build_match else "unknown"
    bank = {
        "version": f"SCP: Secret Laboratory build {build_id}",
        "source": "SCP: Secret Laboratory CASSIE audio assets (CC BY-SA 3.0; see data/licenses)",
        "clips": clips,
    }
    (output_root / "public" / "bank.json").write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    license_dir = output_root / "data" / "licenses"
    license_dir.mkdir(parents=True, exist_ok=True)
    license_copy = license_dir / "scpsl-license.txt"
    license_copy.write_bytes(license_path.read_bytes())
    source_files = {rel.as_posix(): file_sha256(game_root / rel) for rel in (*SOURCE_ASSETS, *SOURCE_RESOURCES)}
    source_files[LICENSE_FILE.as_posix()] = file_sha256(license_path)
    manifest = {
        "product": "SCP: Secret Laboratory",
        "installedBuildId": build_id,
        "sourceFiles": source_files,
        "extractedClipCount": len(clips),
        "audio": {"container": "Ogg Opus", "channels": 1, "sampleRateHz": 48000, "bitrate": "48 kbit/s VBR", "trimmed": False},
        "attribution": "CASSIE audio assets from SCP: Secret Laboratory by Northwood Studios; licensed under CC BY-SA 3.0 according to the installed license.txt. License evidence is copied to data/licenses/scpsl-license.txt.",
        "licenseEvidenceSha256": file_sha256(license_copy),
        "selection": {
            "containers": [rel.as_posix() for rel in SOURCE_ASSETS],
            "wordRule": "mono AudioClips with word-like asset names across the listed serialized assets, plus the explicit CASSIE phrase allowlist in scripts/extract_cassie.py",
            "effects": sorted(EFFECT_NAMES),
            "excludedNonSpeechNames": sorted(NON_CASSIE_NAMES),
            "limitation": "This selection is based on installed asset names/channels and documented CASSIE announcement content; stripped IL2CPP component references do not expose a canonical wordbank table in the installed files.",
        },
        "toolchain": {"UnityPy": UnityPy.__version__ if hasattr(UnityPy, "__version__") else "1.25.4", "imageio-ffmpeg": "0.6.0", "ffmpeg": "7.1 libopus"},
    }
    (output_root / "data" / "source-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(clips)} clips to {audio_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
