"""SQLite persistence for subtitle tasks (stdlib sqlite3, short transactions)."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS subtitle_tasks (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL,
    original_name TEXT NOT NULL,
    input_suffix TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    mock INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    expires_at TEXT,
    error_code TEXT,
    error_detail TEXT
);
"""


@dataclass
class TaskRow:
    id: str
    mode: str
    original_name: str
    input_suffix: str
    status: str
    stage: str
    mock: int
    created_at: str
    started_at: str | None
    finished_at: str | None
    expires_at: str | None
    error_code: str | None
    error_detail: str | None
    sequence: int = 0


def _row_from_tuple(values: tuple) -> TaskRow:
    return TaskRow(
        sequence=values[0],
        id=values[1],
        mode=values[2],
        original_name=values[3],
        input_suffix=values[4],
        status=values[5],
        stage=values[6],
        mock=values[7],
        created_at=values[8],
        started_at=values[9],
        finished_at=values[10],
        expires_at=values[11],
        error_code=values[12],
        error_detail=values[13],
    )


class SubtitleTaskRepository:
    """Thread-safe wrapper around a single SQLite file."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._lock = threading.Lock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(SCHEMA)
            connection.commit()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
        connection.row_factory = None
        return connection

    def create(self, row: TaskRow) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO subtitle_tasks (id, mode, original_name, input_suffix,"
                " status, stage, mock, created_at, started_at, finished_at,"
                " expires_at, error_code, error_detail)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row.id,
                    row.mode,
                    row.original_name,
                    row.input_suffix,
                    row.status,
                    row.stage,
                    row.mock,
                    row.created_at,
                    row.started_at,
                    row.finished_at,
                    row.expires_at,
                    row.error_code,
                    row.error_detail,
                ),
            )
            connection.commit()

    def get(self, task_id: str) -> TaskRow | None:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "SELECT sequence, id, mode, original_name, input_suffix, status,"
                " stage, mock, created_at, started_at, finished_at, expires_at,"
                " error_code, error_detail FROM subtitle_tasks WHERE id = ?",
                (task_id,),
            )
            values = cursor.fetchone()
        return _row_from_tuple(values) if values is not None else None

    def list_recent(self, limit: int, offset: int) -> tuple[list[TaskRow], int]:
        with self._lock, self._connect() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM subtitle_tasks"
            ).fetchone()[0]
            cursor = connection.execute(
                "SELECT sequence, id, mode, original_name, input_suffix, status,"
                " stage, mock, created_at, started_at, finished_at, expires_at,"
                " error_code, error_detail FROM subtitle_tasks"
                " ORDER BY sequence DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
            rows = [_row_from_tuple(values) for values in cursor.fetchall()]
        return rows, int(total)

    def update(self, task_id: str, **changes: object) -> None:
        if not changes:
            return
        columns = ", ".join(f"{key} = ?" for key in changes)
        values = list(changes.values()) + [task_id]
        with self._lock, self._connect() as connection:
            connection.execute(
                f"UPDATE subtitle_tasks SET {columns} WHERE id = ?", values
            )
            connection.commit()

    def count_active(self) -> tuple[int, int]:
        """Return (running_count, queued_count)."""
        with self._lock, self._connect() as connection:
            running = connection.execute(
                "SELECT COUNT(*) FROM subtitle_tasks WHERE status = 'running'"
            ).fetchone()[0]
            queued = connection.execute(
                "SELECT COUNT(*) FROM subtitle_tasks WHERE status = 'queued'"
            ).fetchone()[0]
        return int(running), int(queued)

    def oldest_queued(self) -> TaskRow | None:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "SELECT sequence, id, mode, original_name, input_suffix, status,"
                " stage, mock, created_at, started_at, finished_at, expires_at,"
                " error_code, error_detail FROM subtitle_tasks"
                " WHERE status = 'queued' ORDER BY sequence ASC LIMIT 1"
            )
            values = cursor.fetchone()
        return _row_from_tuple(values) if values is not None else None

    def mark_stale_as_failed(
        self, finished_at: str, expires_at: str
    ) -> list[str]:
        """Mark leftover queued/running rows as failed after a restart."""
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "SELECT id FROM subtitle_tasks WHERE status IN ('queued', 'running')"
            )
            ids = [row[0] for row in cursor.fetchall()]
            for task_id in ids:
                connection.execute(
                    "UPDATE subtitle_tasks SET status='failed', stage='failed',"
                    " finished_at=?, expires_at=?,"
                    " error_code='SERVICE_RESTARTED',"
                    " error_detail=? WHERE id=?",
                    (
                        finished_at,
                        expires_at,
                        "服务重启，未完成的任务已标记为失败，请重新提交。",
                        task_id,
                    ),
                )
            connection.commit()
        return ids

    def fail_queued(self, finished_at: str, expires_at: str) -> list[str]:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "SELECT id FROM subtitle_tasks WHERE status = 'queued'"
            )
            ids = [row[0] for row in cursor.fetchall()]
            for task_id in ids:
                connection.execute(
                    "UPDATE subtitle_tasks SET status='failed', stage='failed',"
                    " finished_at=?, expires_at=?,"
                    " error_code='SERVICE_RESTARTED',"
                    " error_detail=? WHERE id=?",
                    (
                        finished_at,
                        expires_at,
                        "服务正在关闭，排队任务已标记为失败，请重新提交。",
                        task_id,
                    ),
                )
            connection.commit()
        return ids

    def expired_terminal(self, now_iso: str) -> list[TaskRow]:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "SELECT sequence, id, mode, original_name, input_suffix, status,"
                " stage, mock, created_at, started_at, finished_at, expires_at,"
                " error_code, error_detail FROM subtitle_tasks"
                " WHERE status IN ('succeeded', 'failed')"
                " AND expires_at IS NOT NULL AND expires_at <= ?",
                (now_iso,),
            )
            rows = [_row_from_tuple(values) for values in cursor.fetchall()]
        return rows

    def delete(self, task_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM subtitle_tasks WHERE id = ?", (task_id,))
            connection.commit()
