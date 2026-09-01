from __future__ import annotations

from abc import ABC, abstractmethod

from app.core.config import MODEL_CATALOG, AppConfig, Profile
from app.schemas.api import InferenceResult, ModelInfo, Segment


def compute_metrics(duration: float, processing_time: float) -> tuple[float, float]:
    if duration <= 0 or processing_time <= 0:
        return 0.0, 0.0
    return round(processing_time / duration, 4), round(duration / processing_time, 2)


def build_result(
    profile: Profile,
    mock: bool,
    duration: float,
    processing_time: float,
    text: str,
    segments: list[Segment],
) -> InferenceResult:
    """Build the one public result shape shared by both engines."""
    realtime_factor, speed = compute_metrics(duration, processing_time)
    common = {
        "success": True,
        "mock": mock,
        "profile": profile.id,
        "model": profile.model_id,
        "duration": duration,
        "processing_time": processing_time,
        "realtime_factor": realtime_factor,
        "speed": speed,
        "text": text,
        "segments": segments,
    }
    if profile.task == "translate":
        return InferenceResult(
            **common,
            source_language=profile.language,
            target_language=profile.target_language,
        )
    return InferenceResult(**common, language=profile.language)


class BaseInferenceEngine(ABC):
    name: str = "base"
    mock: bool = False
    device: str = "unknown"

    def __init__(self, config: AppConfig):
        self.config = config
        self.loaded_model: str | None = None
        self.busy = False

    @abstractmethod
    async def load_model(self, model_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    async def unload_model(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def transcribe(self, path: str, profile: str) -> InferenceResult:
        raise NotImplementedError

    def is_installed(self, model_id: str) -> bool:
        del model_id
        return True

    def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                id=model_id,
                name=meta["name"],
                type=meta["type"],
                installed=self.is_installed(model_id),
                loaded=self.loaded_model == model_id,
                mock=self.mock,
            )
            for model_id, meta in MODEL_CATALOG.items()
        ]
