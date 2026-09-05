"""Configuration and model metadata for the original local API surface."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.environ.get("TRANS_HUB_CONFIG") or BASE_DIR / "config.toml")

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
DEVICES = ("auto", "cuda")

# Single source of truth for media types accepted by uploads and inference.
SUPPORTED_SUFFIXES = frozenset(
    {
        ".wav",
        ".flac",
        ".mp3",
        ".m4a",
        ".aac",
        ".ogg",
        ".opus",
        ".mp4",
        ".mkv",
        ".webm",
    }
)


DEFAULT_DATA_DIR = "./data"
DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_MAX_WAITING = 3
DEFAULT_RETENTION_DAYS = 7


@dataclass(frozen=True)
class Profile:
    id: str
    model_id: str
    task: str
    language: str
    target_language: str | None = None


@dataclass(frozen=True)
class SubtitleTaskSettings:
    data_directory: Path
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES
    max_waiting: int = DEFAULT_MAX_WAITING
    retention_days: int = DEFAULT_RETENTION_DAYS


@dataclass(frozen=True)
class FasterWhisperSettings:
    device: str = "auto"
    compute_type: str = "default"


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    engine: str
    output_directory: Path
    models_directory: Path
    upload_directory: Path
    profiles: dict[str, Profile]
    faster_whisper: FasterWhisperSettings = FasterWhisperSettings()
    subtitle_tasks: SubtitleTaskSettings | None = None

    def profile(self, profile_id: str) -> Profile | None:
        return self.profiles.get(profile_id)

    @property
    def resolved_subtitle_tasks(self) -> SubtitleTaskSettings:
        if self.subtitle_tasks is not None:
            return self.subtitle_tasks
        return SubtitleTaskSettings(data_directory=BASE_DIR / "data")


def model_dir_is_complete(directory: Path) -> bool:
    return all((directory / name).is_file() for name in REQUIRED_MODEL_FILES)


def _resolve_directory(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else BASE_DIR / path


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
    tasks_raw = raw.get("subtitle_tasks", {})
    data_directory = _resolve_directory(
        tasks_raw.get("data_directory", DEFAULT_DATA_DIR)
    )
    try:
        max_upload_bytes = int(
            tasks_raw.get("max_upload_bytes", DEFAULT_MAX_UPLOAD_BYTES)
        )
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Invalid [subtitle_tasks] max_upload_bytes") from exc
    if max_upload_bytes <= 0:
        raise RuntimeError("[subtitle_tasks] max_upload_bytes must be positive")
    max_waiting = int(tasks_raw.get("max_waiting", DEFAULT_MAX_WAITING))
    retention_days = int(tasks_raw.get("retention_days", DEFAULT_RETENTION_DAYS))
    env_upload = os.environ.get("TRANSFERHUB_MAX_UPLOAD_BYTES", "").strip()
    if env_upload:
        try:
            max_upload_bytes = int(env_upload)
        except ValueError as exc:
            raise RuntimeError(
                "TRANSFERHUB_MAX_UPLOAD_BYTES must be an integer"
            ) from exc
        if max_upload_bytes <= 0:
            raise RuntimeError("TRANSFERHUB_MAX_UPLOAD_BYTES must be positive")
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
        upload_directory=_resolve_directory(
            raw.get("upload", {}).get("directory", "./uploads")
        ),
        profiles=profiles,
        faster_whisper=FasterWhisperSettings(
            device=device,
            compute_type=str(faster_whisper.get("compute_type", "default")).lower(),
        ),
        subtitle_tasks=SubtitleTaskSettings(
            data_directory=data_directory,
            max_upload_bytes=max_upload_bytes,
            max_waiting=max_waiting,
            retention_days=retention_days,
        ),
    )
