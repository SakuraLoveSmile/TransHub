from __future__ import annotations

from app.core.errors import ModelLoadError
from app.engines.base import BaseInferenceEngine
from app.schemas.api import InferenceResult, ModelInfo


class FasterWhisperEngine(BaseInferenceEngine):
    """Phase 1 target: faster-whisper + CTranslate2 backend.

    Model ids map to local directories under ``models/``:
    ``whisper-ja-1.5b``  -> TransWithAI/whisper-ja-1.5B-ct2
    ``chickenrice-v2``   -> chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2
    """

    name = "faster-whisper"
    mock = False
    device = "unknown"

    def __init__(self, *args, **kwargs):
        raise ModelLoadError(
            "FasterWhisperEngine is not implemented yet (Phase 1). "
            'Set engine = "mock" in config.toml.'
        )

    async def load_model(self, model_id: str) -> None:  # pragma: no cover - Phase 1
        raise NotImplementedError

    async def unload_model(self) -> None:  # pragma: no cover - Phase 1
        raise NotImplementedError

    async def transcribe(self, path: str, profile: str) -> InferenceResult:  # pragma: no cover
        raise NotImplementedError

    def list_models(self) -> list[ModelInfo]:  # pragma: no cover - Phase 1
        raise NotImplementedError
