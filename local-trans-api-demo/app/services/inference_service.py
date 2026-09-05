from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from app.core.errors import EngineBusyError, UnknownProfileError
from app.core.state import AppState
from app.schemas.api import InferenceResult
from app.utils.output import write_outputs

logger = logging.getLogger("app.inference")


class InferenceService:
    def __init__(self, state: AppState):
        self.state = state

    @asynccontextmanager
    async def _engine_slot(self) -> AsyncIterator[None]:
        if self.state.lock.locked():
            raise EngineBusyError("Inference engine is busy")
        await self.state.lock.acquire()
        self.state.engine.busy = True
        try:
            yield
        finally:
            self.state.engine.busy = False
            self.state.lock.release()

    @asynccontextmanager
    async def wait_engine_slot(self) -> AsyncIterator[None]:
        """Acquire the shared engine slot, waiting instead of failing busy."""
        await self.state.lock.acquire()
        self.state.engine.busy = True
        try:
            yield
        finally:
            self.state.engine.busy = False
            self.state.lock.release()

    async def _run_profile_holding_lock(
        self, profile_id: str, path: str
    ) -> InferenceResult:
        """Run model-switch + inference; caller must already hold the slot."""
        from app.core.errors import UnknownProfileError as _UnknownProfile

        profile = self.state.config.profile(profile_id)
        if profile is None:
            raise _UnknownProfile(f"Unknown profile: {profile_id}")
        filename = Path(path).name
        try:
            await self._ensure_model(profile.model_id)
            result = await self.state.engine.transcribe(path, profile.id)
        except Exception:
            logger.exception(
                "Inference failed profile=%s file=%s outcome=failed",
                profile.id,
                filename,
            )
            raise
        return result

    async def infer(self, profile_id: str, path: str) -> InferenceResult:
        profile = self.state.config.profile(profile_id)
        if profile is None:
            raise UnknownProfileError(f"Unknown profile: {profile_id}")
        filename = Path(path).name
        async with self._engine_slot():
            result = await self._run_profile_holding_lock(profile_id, path)

            try:
                outputs = write_outputs(
                    result,
                    source_path=path,
                    output_directory=self.state.config.output_directory,
                    task=profile.task,
                )
                logger.info("Wrote %s", ", ".join(str(p) for p in outputs))
            except Exception as error:
                logger.warning(
                    "Failed to write outputs for %s: %s",
                    path,
                    error,
                    exc_info=True,
                )

            logger.info(
                "Inference completed profile=%s file=%s duration=%.2f processing_time=%.3f outcome=success",
                profile.id,
                filename,
                result.duration,
                result.processing_time,
            )
            return result

    async def load_model(self, model_id: str) -> None:
        async with self._engine_slot():
            started = time.perf_counter()
            if self.state.engine.loaded_model != model_id:
                await self._ensure_model(model_id)
            elapsed = time.perf_counter() - started
            logger.info("Loaded model %s in %.3fs", model_id, elapsed)

    async def unload_model(self) -> None:
        async with self._engine_slot():
            started = time.perf_counter()
            await self.state.engine.unload_model()
            elapsed = time.perf_counter() - started
            logger.info("Unloaded model in %.3fs", elapsed)

    async def _ensure_model(self, model_id: str) -> None:
        engine = self.state.engine
        if engine.loaded_model == model_id:
            return
        if engine.loaded_model is not None:
            await engine.unload_model()
        await engine.load_model(model_id)

