from __future__ import annotations

import logging

from app.core.errors import EngineBusyError, UnknownProfileError
from app.core.state import AppState
from app.schemas.api import InferenceResult
from app.utils.output import write_outputs

logger = logging.getLogger("app.inference")


class InferenceService:
    """Routes go through here; no route talks to an engine directly."""

    def __init__(self, state: AppState):
        self.state = state

    async def infer(self, profile_id: str, path: str) -> InferenceResult:
        config = self.state.config
        profile = config.profile(profile_id)
        if profile is None:
            raise UnknownProfileError(f"Unknown profile: {profile_id}")

        # No await between locked() and acquire(), so one loop stays conflict-free.
        if self.state.lock.locked():
            raise EngineBusyError("Inference engine is busy")
        await self.state.lock.acquire()
        self.state.engine.busy = True
        try:
            await self._ensure_model(profile.model_id)
            result = await self.state.engine.transcribe(path, profile.id)
            outputs = write_outputs(
                result,
                source_path=path,
                output_directory=config.output_directory,
                task=profile.task,
            )
            logger.info("Wrote %s", ", ".join(str(p) for p in outputs))
            return result
        finally:
            self.state.engine.busy = False
            self.state.lock.release()

    async def load_model(self, model_id: str) -> None:
        engine = self.state.engine
        if engine.loaded_model == model_id:
            return
        await self._ensure_model(model_id)

    async def unload_model(self) -> None:
        await self.state.engine.unload_model()

    async def _ensure_model(self, model_id: str) -> None:
        engine = self.state.engine
        if engine.loaded_model == model_id:
            return
        if engine.loaded_model is not None:
            logger.info("Switching model %s -> %s", engine.loaded_model, model_id)
            await engine.unload_model()
        logger.info("Loading model %s", model_id)
        await engine.load_model(model_id)
