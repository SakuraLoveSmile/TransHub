from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.environ.get("TRANS_HUB_CONFIG") or BASE_DIR / "config.toml")

# Model metadata for the ids referenced by profiles. ``repo_id`` is only used by
# scripts/download_models.py; inference loads the local directory models/<model_id>.
MODEL_CATALOG: dict[str, dict[str, str]] = {
    "whisper-ja-1.5b": {
        "name": "Japanese Whisper 1.5B",
        "type": "transcription",
        "repo_id": "TransWithAI/whisper-ja-1.5B-ct2",
    },
    "chickenrice-v2": {
        "name": "ChickenRice v2",
        "type": "speech_translation",
        "repo_id": "chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2",
    },
}


REQUIRED_MODEL_FILES = ("model.bin", "config.json", "tokenizer.json")

DEVICES = ("auto", "cpu", "cuda")


@dataclass(frozen=True)
class Profile:
    id: str
    model_id: str
    task: str
    language: str
    target_language: str | None = None


@dataclass(frozen=True)
class FasterWhisperSettings:
    """``[faster_whisper]``: force the device so section 48's CPU-fallback check
    can run on a machine that does have CUDA. ``compute_type`` is handed to
    CTranslate2 as-is."""

    device: str = "auto"
    compute_type: str = "default"


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    engine: str
    output_directory: Path
    models_directory: Path
    profiles: dict[str, Profile]
    faster_whisper: FasterWhisperSettings = FasterWhisperSettings()

    def profile(self, profile_id: str) -> Profile | None:
        return self.profiles.get(profile_id)


def model_dir_is_complete(directory: Path) -> bool:
    """A half-finished download is not a usable model."""
    return all((directory / name).is_file() for name in REQUIRED_MODEL_FILES)


def _resolve_directory(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


def load_config(path: Path = CONFIG_PATH) -> AppConfig:
    with path.open("rb") as handle:
        raw = tomllib.load(handle)

    profiles: dict[str, Profile] = {}
    for entry in raw.get("profiles", {}).values():
        profile = Profile(
            id=entry["id"],
            model_id=entry["model_id"],
            task=entry["task"],
            language=entry["language"],
            target_language=entry.get("target_language"),
        )
        profiles[profile.id] = profile

    server = raw.get("server", {})
    faster_whisper = raw.get("faster_whisper", {})
    device = str(faster_whisper.get("device", "auto")).lower()
    if device not in DEVICES:
        raise RuntimeError(
            f"Unknown [faster_whisper] device: {device!r} (expected one of {DEVICES})"
        )
    return AppConfig(
        host=server.get("host", "127.0.0.1"),
        port=int(server.get("port", 8765)),
        engine=raw.get("inference", {}).get("engine", "mock"),
        output_directory=_resolve_directory(
            raw.get("output", {}).get("directory", "./output")
        ),
        models_directory=_resolve_directory(
            raw.get("models", {}).get("directory", "./models")
        ),
        profiles=profiles,
        faster_whisper=FasterWhisperSettings(
            device=device,
            compute_type=str(faster_whisper.get("compute_type", "default")).lower(),
        ),
    )
