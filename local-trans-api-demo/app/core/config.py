from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = BASE_DIR / "config.toml"

# Display metadata for model ids referenced by profiles.
MODEL_CATALOG: dict[str, dict[str, str]] = {
    "whisper-ja-1.5b": {
        "name": "Japanese Whisper 1.5B",
        "type": "transcription",
    },
    "chickenrice-v2": {
        "name": "ChickenRice v2",
        "type": "speech_translation",
    },
}


@dataclass(frozen=True)
class Profile:
    id: str
    model_id: str
    task: str
    language: str
    target_language: str | None = None


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    engine: str
    output_directory: Path
    models_directory: Path
    profiles: dict[str, Profile]

    def profile(self, profile_id: str) -> Profile | None:
        return self.profiles.get(profile_id)


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
    )
