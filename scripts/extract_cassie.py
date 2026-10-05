#!/usr/bin/env python3
"""Extract the installed CASSIE speech bank and encode browser-ready Opus clips."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import struct
import subprocess
import sys
import wave
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
    "bell_start",
    "bell_end",
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
CASSIE_BACKGROUND_PATH_ID = 3200
ANNOUNCEMENT_START_SECONDS = 2.5
ANNOUNCEMENT_END_SECONDS = 29.100000381469727
CASSIE_CUE_WINDOWS = {
    "cassie-start": (0.0, ANNOUNCEMENT_START_SECONDS),
    "cassie-end": (ANNOUNCEMENT_END_SECONDS, None),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: dict) -> None:
    path.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


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


def slice_wav(wav: bytes, start_seconds: float, end_seconds: float | None) -> tuple[bytes, dict[str, int | float]]:
    with wave.open(io.BytesIO(wav), "rb") as source:
        params = source.getparams()
        total_frames = source.getnframes()
        start_frame = round(start_seconds * params.framerate)
        end_frame = total_frames if end_seconds is None else round(end_seconds * params.framerate)
        if not 0 <= start_frame < end_frame <= total_frames:
            raise RuntimeError(f"Invalid cue window {start_seconds}-{end_seconds} for {total_frames} frames")
        source.setpos(start_frame)
        frames = source.readframes(end_frame - start_frame)

    cropped = io.BytesIO()
    with wave.open(cropped, "wb") as target:
        target.setparams(params._replace(nframes=0))
        target.writeframes(frames)
    return cropped.getvalue(), {
        "startSample": start_frame,
        "endSample": end_frame,
        "sampleRateHz": params.framerate,
        "startSeconds": start_frame / params.framerate,
        "endSeconds": end_frame / params.framerate,
    }


def build_announcement_cues(game_root: Path, output_root: Path, ffmpeg: str) -> tuple[list[dict], dict]:
    source_asset = Path("SCPSL_Data/sharedassets2.assets")
    env = UnityPy.load(str(game_root / source_asset))
    source_obj = next(
        (obj for obj in env.objects if obj.type.name == "AudioClip" and obj.path_id == CASSIE_BACKGROUND_PATH_ID),
        None,
    )
    if source_obj is None:
        raise RuntimeError(f"AudioClip pathID {CASSIE_BACKGROUND_PATH_ID} was not found in {source_asset}")
    audio = source_obj.read()
    if audio.m_Name != "CASSIE-background-std":
        raise RuntimeError(f"Unexpected AudioClip at source pathID {CASSIE_BACKGROUND_PATH_ID}: {audio.m_Name!r}")
    samples = extract_audioclip_samples(audio)
    if len(samples) != 1:
        raise RuntimeError("CASSIE-background-std did not decode to exactly one WAV stream")
    source_wav = next(iter(samples.values()))
    source_wav_sha256 = sha256(source_wav)
    source_links = validate_background_player_links(game_root, CASSIE_BACKGROUND_PATH_ID)
    audio_dir = output_root / "public" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    clips = []
    windows = {}
    for cid, (start_seconds, end_seconds) in CASSIE_CUE_WINDOWS.items():
        wav, window = slice_wav(source_wav, start_seconds, end_seconds)
        opus = encode_opus(wav, ffmpeg)
        (audio_dir / f"{cid}.opus").write_bytes(opus)
        window["sourceStartSeconds"] = start_seconds
        window["sourceEndSeconds"] = audio.m_Length if end_seconds is None else end_seconds
        window["sourceDecodedWavSha256"] = source_wav_sha256
        window["decodedWavSha256"] = sha256(wav)
        window["opusSha256"] = sha256(opus)
        windows[cid] = window
        clips.append(
            {
                "id": cid,
                "file": f"/audio/{cid}.opus",
                "duration": round((window["endSample"] - window["startSample"]) / window["sampleRateHz"], 6),
                "kind": "effect",
                "sourceName": f"{audio.m_Name} ({cid.removeprefix('cassie-')} excerpt)",
                "sourceContainer": source_asset.as_posix(),
                "sourcePathId": int(source_obj.path_id),
                "sourceFrequency": int(audio.m_Frequency or 0),
                "sourceChannels": int(audio.m_Channels or 0),
                "decodedWavSha256": sha256(wav),
                "sha256": sha256(opus),
                "sourceWindow": window,
            }
        )
    provenance = {
        "sourceName": audio.m_Name,
        "sourceContainer": source_asset.as_posix(),
        "sourcePathId": int(source_obj.path_id),
        "sourceFrequency": int(audio.m_Frequency or 0),
        "sourceChannels": int(audio.m_Channels or 0),
        "sourceDurationSeconds": float(audio.m_Length),
        "sourceDecodedWavSha256": source_wav_sha256,
        "unityReferences": source_links,
        "boundaries": {
            "startSeconds": ANNOUNCEMENT_START_SECONDS,
            "endSeconds": ANNOUNCEMENT_END_SECONDS,
            "evidence": "Static code shows CassieTtsAnnouncer shifts voice start by AnnouncementStart (2.5 seconds), and CassieBackgroundPlayer schedules the starting source at that timestamp and the ending source at voice end minus AnnouncementEnd (29.1 seconds). Both AudioSources point to this clip. These excerpts preserve only the source boundary windows; they do not reproduce runtime queueing or AudioSource volume crossfades.",
        },
        "windows": windows,
    }
    return clips, provenance


def validate_background_player_links(game_root: Path, source_clip_path_id: int) -> dict:
    env = UnityPy.load(str(game_root / "SCPSL_Data" / "level2"))
    objects = {obj.path_id: obj for obj in env.objects}
    background_players = []
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        data = obj.get_raw_data()
        if len(data) < 44:
            continue
        script_file_id, script_path_id = struct.unpack_from("<iq", data, 16)
        if script_file_id == 1 and script_path_id == 1150:
            game_object_file_id, game_object_path_id = struct.unpack_from("<iq", data, 0)
            start_file_id, start_source_id = struct.unpack_from("<iq", data, 32)
            start_curve_count = struct.unpack_from("<i", data, 44)[0]
            end_source_offset = 44 + 4 + start_curve_count * 28 + 12
            if end_source_offset + 12 > len(data):
                raise RuntimeError("CassieBackgroundPlayer start curve exceeds its serialized component data")
            end_file_id, end_source_id = struct.unpack_from("<iq", data, end_source_offset)
            background_players.append(
                {
                    "componentPathId": int(obj.path_id),
                    "gameObjectFileId": game_object_file_id,
                    "gameObjectPathId": game_object_path_id,
                    "startingSourceFileId": start_file_id,
                    "startingSourcePathId": start_source_id,
                    "startingCurveKeyCount": start_curve_count,
                    "endingSourceFileId": end_file_id,
                    "endingSourcePathId": end_source_id,
                    "endingCurveKeyCount": struct.unpack_from("<i", data, end_source_offset + 12)[0],
                }
            )
    if len(background_players) != 1:
        raise RuntimeError(f"Expected one serialized CassieBackgroundPlayer in level2; found {len(background_players)}")
    player = background_players[0]
    go = objects.get(player["gameObjectPathId"])
    if player["gameObjectFileId"] != 0 or go is None or go.read().m_Name != "Background Player":
        raise RuntimeError("CassieBackgroundPlayer is not attached to the expected Background Player GameObject")
    for field, file_key in (("startingSourcePathId", "startingSourceFileId"), ("endingSourcePathId", "endingSourceFileId")):
        source_id = player[field]
        source = objects.get(source_id)
        if player[file_key] != 0 or source is None or source.type.name != "AudioSource":
            raise RuntimeError(f"CassieBackgroundPlayer field {field} does not resolve to a local AudioSource")
        audio_source = source.read()
        if audio_source.m_audioClip.file_id != 2 or audio_source.m_audioClip.path_id != source_clip_path_id:
            raise RuntimeError(f"AudioSource {source_id} does not reference sharedassets2 AudioClip {source_clip_path_id}")
    return {
        "level": "SCPSL_Data/level2",
        "gameObject": {"pathId": player["gameObjectPathId"], "name": "Background Player"},
        "backgroundPlayer": {"scriptFileId": 1, "scriptPathId": 1150, "componentPathId": player["componentPathId"]},
        "startingAudioSource": {
            "pathId": player["startingSourcePathId"],
            "clipFileId": 2,
            "clipPathId": source_clip_path_id,
            "transitionCurveKeyCount": player["startingCurveKeyCount"],
        },
        "endingAudioSource": {
            "pathId": player["endingSourcePathId"],
            "clipFileId": 2,
            "clipPathId": source_clip_path_id,
            "transitionCurveKeyCount": player["endingCurveKeyCount"],
        },
    }


def update_announcement_manifest(manifest: dict, provenance: dict, clip_count: int) -> None:
    manifest["extractedClipCount"] = clip_count
    manifest["audio"]["derivedCueWindows"] = True
    manifest["selection"]["announcementCues"] = {
        "start": "cassie-start",
        "end": "cassie-end",
        "evidence": "CassieBackgroundPlayer on the Background Player GameObject references two AudioSources; both source AudioClips resolve to CASSIE-background-std. Source-defined announcement offsets support the start and end excerpts documented in derivedCueExcerpts.",
    }
    manifest["selection"]["derivedCueExcerpts"] = provenance


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-root", type=Path, required=True, help="Installed SCP: Secret Laboratory directory")
    parser.add_argument("--output-root", type=Path, default=Path(__file__).resolve().parents[1], help="CASSIE repository root")
    parser.add_argument("--cues-only", action="store_true", help="Rebuild only the source-backed start/end cue excerpts")
    args = parser.parse_args()

    game_root = args.game_root.resolve()
    output_root = args.output_root.resolve()
    asset_paths = [game_root / rel for rel in SOURCE_ASSETS]
    resource_paths = [game_root / rel for rel in SOURCE_RESOURCES]
    license_path = game_root / LICENSE_FILE
    for required in (*asset_paths, *resource_paths, license_path):
        if not required.is_file():
            parser.error(f"Required installed-game file is missing: {required}")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    if args.cues_only:
        bank_path = output_root / "public" / "bank.json"
        manifest_path = output_root / "data" / "source-manifest.json"
        if not bank_path.is_file() or not manifest_path.is_file():
            parser.error("--cues-only requires existing public/bank.json and data/source-manifest.json")
        cue_clips, cue_provenance = build_announcement_cues(game_root, output_root, ffmpeg)
        bank = json.loads(bank_path.read_text(encoding="utf-8"))
        bank["clips"] = [clip for clip in bank["clips"] if clip["id"] not in CASSIE_CUE_WINDOWS]
        bank["clips"].extend(cue_clips)
        bank["clips"].sort(key=lambda clip: clip["id"])
        write_json(bank_path, bank)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        update_announcement_manifest(manifest, cue_provenance, len(bank["clips"]))
        write_json(manifest_path, manifest)
        print("Rebuilt source-backed CASSIE start/end cue excerpts")
        return 0

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

    cue_clips, cue_provenance = build_announcement_cues(game_root, output_root, ffmpeg)
    clips.extend(cue_clips)
    clips.sort(key=lambda clip: clip["id"])

    steam_manifest = game_root.parent.parent / "appmanifest_700330.acf"
    build_match = re.search(r'"buildid"\s+"(\d+)"', steam_manifest.read_text(encoding="utf-8", errors="replace")) if steam_manifest.is_file() else None
    build_id = build_match.group(1) if build_match else "unknown"
    bank = {
        "version": f"SCP: Secret Laboratory build {build_id}",
        "source": "SCP: Secret Laboratory CASSIE audio assets (CC BY-SA 3.0; see data/licenses)",
        "clips": clips,
    }
    write_json(output_root / "public" / "bank.json", bank)

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
        "audio": {"container": "Ogg Opus", "channels": 1, "sampleRateHz": 48000, "bitrate": "48 kbit/s VBR", "trimmed": False, "derivedCueWindows": True},
        "attribution": "CASSIE audio assets from SCP: Secret Laboratory by Northwood Studios; licensed under CC BY-SA 3.0 according to the installed license.txt. License evidence is copied to data/licenses/scpsl-license.txt.",
        "licenseEvidenceSha256": file_sha256(license_copy),
        "selection": {
            "containers": [rel.as_posix() for rel in SOURCE_ASSETS],
            "wordRule": "mono AudioClips with word-like asset names across the listed serialized assets, plus the explicit CASSIE phrase allowlist in scripts/extract_cassie.py",
            "effects": sorted(EFFECT_NAMES),
            "excludedNonSpeechNames": sorted(NON_CASSIE_NAMES),
            "announcementCues": {
                "start": "cassie-start",
                "end": "cassie-end",
                "evidence": "CassieBackgroundPlayer on the Background Player GameObject references two AudioSources; both source AudioClips resolve to CASSIE-background-std. Source-defined announcement offsets support the start and end excerpts documented in derivedCueExcerpts.",
            },
            "derivedCueExcerpts": cue_provenance,
            "limitation": "This selection is based on installed asset names/channels and documented CASSIE announcement content; stripped IL2CPP component references do not expose a canonical wordbank table in the installed files.",
        },
        "toolchain": {"UnityPy": UnityPy.__version__ if hasattr(UnityPy, "__version__") else "1.25.4", "imageio-ffmpeg": "0.6.0", "ffmpeg": "7.1 libopus"},
    }
    write_json(output_root / "data" / "source-manifest.json", manifest)
    print(f"Wrote {len(clips)} clips to {audio_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
