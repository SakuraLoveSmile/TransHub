from __future__ import annotations

import asyncio

from app.core.config import MODEL_CATALOG
from app.core.errors import UnknownModelError, UnknownProfileError
from app.engines.base import BaseInferenceEngine, compute_metrics
from app.schemas.api import InferenceResult, ModelInfo, Segment

# Fixed delay keeps the demo deterministic while still exercising Loading,
# Processing and Busy states in the UI.
LOAD_DELAY = 0.3
UNLOAD_DELAY = 0.1
INFER_DELAY = 1.5

DURATION = 125.4

TRANSCRIBE_RESULT = {
    "processing_time": 1.8,
    "text": "こんばんは。今日はよろしくお願いします。",
    "segments": [
        {"start": 0.8, "end": 3.4, "text": "こんばんは。"},
        {"start": 3.8, "end": 7.2, "text": "今日はよろしくお願いします。"},
    ],
}

TRANSLATE_RESULT = {
    "processing_time": 1.9,
    "text": "晚上好。今天请多关照。",
    "segments": [
        {"start": 0.8, "end": 3.4, "text": "晚上好。"},
        {"start": 3.8, "end": 7.2, "text": "今天请多关照。"},
    ],
}

KNOWN_MODELS = tuple(MODEL_CATALOG)


class MockEngine(BaseInferenceEngine):
    """Plumbing-only engine: same schema and timings as the real one."""

    name = "mock"
    mock = True
    device = "mock"

    async def load_model(self, model_id: str) -> None:
        if model_id not in MODEL_CATALOG:
            raise UnknownModelError(f"Unknown model: {model_id}")
        await asyncio.sleep(LOAD_DELAY)
        self.loaded_model = model_id

    async def unload_model(self) -> None:
        await asyncio.sleep(UNLOAD_DELAY)
        self.loaded_model = None

    async def transcribe(self, path: str, profile: str) -> InferenceResult:
        resolved = self.profiles.get(profile)
        if resolved is None:
            raise UnknownProfileError(f"Unknown profile: {profile}")

        await asyncio.sleep(INFER_DELAY)
        is_translation = resolved.task == "translate"
        data = TRANSLATE_RESULT if is_translation else TRANSCRIBE_RESULT
        realtime_factor, speed = compute_metrics(DURATION, data["processing_time"])
        common = {
            "success": True,
            "mock": True,
            "profile": resolved.id,
            "model": resolved.model_id,
            "duration": DURATION,
            "processing_time": data["processing_time"],
            "realtime_factor": realtime_factor,
            "speed": speed,
            "text": data["text"],
            "segments": [Segment(**segment) for segment in data["segments"]],
        }
        if is_translation:
            return InferenceResult(
                **common,
                source_language=resolved.language,
                target_language=resolved.target_language,
            )
        return InferenceResult(**common, language=resolved.language)

    def list_models(self) -> list[ModelInfo]:
        return [
            ModelInfo(
                id=model_id,
                name=meta["name"],
                type=meta["type"],
                installed=True,
                loaded=self.loaded_model == model_id,
                mock=True,
            )
            for model_id, meta in MODEL_CATALOG.items()
        ]
