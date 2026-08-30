from __future__ import annotations

from abc import ABC, abstractmethod

from app.core.config import Profile
from app.schemas.api import InferenceResult, ModelInfo


def compute_metrics(
    duration: float, processing_time: float
) -> tuple[float, float]:
    """Return (realtime_factor, speed) as used by both Mock and real engines."""
    if duration <= 0 or processing_time <= 0:
        return 0.0, 0.0
    return (
        round(processing_time / duration, 4),
        round(duration / processing_time, 2),
    )


class BaseInferenceEngine(ABC):
    """Shared contract for every engine; API, UI and outputs depend only on this."""

    name: str = "base"
    mock: bool = False
    device: str = "unknown"

    def __init__(self, profiles: dict[str, Profile]):
        self.profiles = profiles
        self.loaded_model: str | None = None
        self.busy: bool = False

    @abstractmethod
    async def load_model(self, model_id: str) -> None:
        pass

    @abstractmethod
    async def unload_model(self) -> None:
        pass

    @abstractmethod
    async def transcribe(self, path: str, profile: str) -> InferenceResult:
        pass

    @abstractmethod
    def list_models(self) -> list[ModelInfo]:
        pass
