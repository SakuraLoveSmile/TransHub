from __future__ import annotations

import asyncio
import gc
import logging
import time
from pathlib import Path

from app.core.config import (
    MODEL_CATALOG,
    SUPPORTED_SUFFIXES,
    AppConfig,
    Profile,
    model_dir_is_complete,
)
from app.core.errors import (
    InferenceError,
    InvalidPathError,
    ModelLoadError,
    ModelNotInstalledError,
    UnknownModelError,
    UnknownProfileError,
    UnsupportedFileError,
)
from app.engines.base import BaseInferenceEngine, build_result
from app.schemas.api import InferenceResult, Segment

logger = logging.getLogger("app.engine.faster-whisper")
TRANSCRIBE_OPTIONS = {
    "beam_size": 1,
    "condition_on_previous_text": False,
    "vad_filter": True,
}


def select_device(device: str = "auto", compute_type: str = "default") -> tuple[str, str]:
    if device == "auto":
        try:
            import ctranslate2

            has_cuda = ctranslate2.get_cuda_device_count() > 0
        except Exception:  # noqa: BLE001 - CUDA fallback must survive broken runtimes
            has_cuda = False
        device = "cuda" if has_cuda else "cpu"
    if compute_type == "default":
        compute_type = "float16" if device == "cuda" else "int8"
    return device, compute_type


class FasterWhisperEngine(BaseInferenceEngine):
    """Optional real backend with the same ``InferenceResult`` builder."""

    name = "faster-whisper"
    mock = False

    def __init__(self, config: AppConfig):
        super().__init__(config)
        self.model = None
        self.device, self.compute_type = select_device(
            config.faster_whisper.device, config.faster_whisper.compute_type
        )

    def model_directory(self, model_id: str) -> Path:
        return self.config.models_directory / model_id

    def is_installed(self, model_id: str) -> bool:
        return model_dir_is_complete(self.model_directory(model_id))

    async def load_model(self, model_id: str) -> None:
        if model_id not in MODEL_CATALOG:
            raise UnknownModelError(f"Unknown model: {model_id}")
        directory = self.model_directory(model_id)
        if not self.is_installed(model_id):
            raise ModelNotInstalledError(f"Model not installed: {model_id}")
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise ModelLoadError("faster-whisper is not installed") from error
        try:
            self.model = await asyncio.to_thread(
                WhisperModel,
                str(directory),
                device=self.device,
                compute_type=self.compute_type,
            )
        except Exception as error:
            self.model = None
            raise ModelLoadError(f"Model load failed: {model_id}") from error
        self.loaded_model = model_id

    async def unload_model(self) -> None:
        self.model = None
        self.loaded_model = None
        gc.collect()

    async def transcribe(self, path: str, profile: str) -> InferenceResult:
        resolved = self.config.profiles.get(profile)
        if resolved is None:
            raise UnknownProfileError(f"Unknown profile: {profile}")
        media = self._validated_media(path)
        started = time.perf_counter()
        try:
            segments, duration = await asyncio.to_thread(self._infer, media, resolved)
        except Exception as error:
            logger.exception("Inference failed for %s", path)
            raise InferenceError("Inference failed") from error
        processing_time = round(time.perf_counter() - started, 3)
        return build_result(
            resolved,
            mock=False,
            duration=duration,
            processing_time=processing_time,
            text="".join(segment.text for segment in segments).strip(),
            segments=segments,
        )

    def _infer(self, media: Path, profile: Profile) -> tuple[list[Segment], float]:
        segments, info = self.model.transcribe(
            str(media), task=profile.task, language=profile.language, **TRANSCRIBE_OPTIONS
        )
        items = [
            Segment(
                start=round(segment.start, 3),
                end=round(segment.end, 3),
                text=segment.text.strip(),
            )
            for segment in segments
        ]
        duration = (
            float(info.duration) if info.duration else (items[-1].end if items else 0.0)
        )
        return items, duration

    def _validated_media(self, path: str) -> Path:
        candidate = Path(path)
        if candidate.is_dir() or not candidate.is_file():
            raise InvalidPathError(f"File not found: {path}")
        if candidate.suffix.lower() not in SUPPORTED_SUFFIXES:
            raise UnsupportedFileError(
                f"Unsupported file type: {candidate.suffix or '(no extension)'}"
            )
        return candidate
