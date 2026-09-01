"""Task lifecycle orchestration for transcription requests."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from uuid import uuid4

from app.providers.transcription import TranscriptionProvider
from app.schemas.v1 import (
    ErrorInfo,
    Task,
    TranscriptionRequest,
)
from app.services.task_store import TaskStore

LOGGER = logging.getLogger("transferhub.transcription")


class TranscriptionService:
    """Create tasks and move them through the provider-backed lifecycle."""

    def __init__(
        self,
        *,
        provider: TranscriptionProvider,
        task_store: TaskStore,
    ) -> None:
        self._provider = provider
        self._task_store = task_store
        self._background_tasks: set[asyncio.Task[None]] = set()

    def submit(self, request: TranscriptionRequest) -> Task:
        now = datetime.now(UTC)
        task = Task(
            id=f"tsk_{uuid4().hex}",
            type="transcription",
            status="queued",
            created_at=now,
            updated_at=now,
        )
        stored_task = self._task_store.create(task)
        background_task = asyncio.create_task(
            self._execute(
                task_id=task.id,
                path=request.input.path,
                language=request.language,
            ),
            name=f"transcription:{task.id}",
        )
        self._background_tasks.add(background_task)
        background_task.add_done_callback(self._forget_background_task)
        return stored_task

    def get_task(self, task_id: str) -> Task | None:
        return self._task_store.get(task_id)

    async def shutdown(self) -> None:
        """Cancel unfinished in-memory work when the application stops."""
        tasks = list(self._background_tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._background_tasks.clear()

    async def _execute(self, *, task_id: str, path: str, language: str) -> None:
        self._task_store.update(
            task_id,
            status="running",
            updated_at=datetime.now(UTC),
        )
        try:
            result = await self._provider.transcribe(path, language)
        except Exception:
            LOGGER.exception("Transcription task failed task_id=%s", task_id)
            self._task_store.update(
                task_id,
                status="failed",
                result=None,
                error=ErrorInfo(
                    code="TRANSCRIPTION_FAILED",
                    message="Transcription failed.",
                    details=None,
                ),
                updated_at=datetime.now(UTC),
            )
            return

        self._task_store.update(
            task_id,
            status="completed",
            result=result,
            error=None,
            updated_at=datetime.now(UTC),
        )

    def _forget_background_task(self, task: asyncio.Task[None]) -> None:
        self._background_tasks.discard(task)
