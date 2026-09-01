"""In-memory storage for v1 transcription tasks."""

from __future__ import annotations

from app.schemas.v1 import Task


class TaskStore:
    """Keep task state in memory for the lifetime of the application."""

    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}

    def create(self, task: Task) -> Task:
        if task.id in self._tasks:
            raise ValueError(f"Task already exists: {task.id}")
        self._tasks[task.id] = task.model_copy(deep=True)
        return task.model_copy(deep=True)

    def get(self, task_id: str) -> Task | None:
        task = self._tasks.get(task_id)
        return task.model_copy(deep=True) if task is not None else None

    def update(self, task_id: str, **changes: object) -> Task | None:
        task = self._tasks.get(task_id)
        if task is None:
            return None
        updated_task = task.model_copy(update=changes, deep=True)
        self._tasks[task_id] = updated_task
        return updated_task.model_copy(deep=True)
