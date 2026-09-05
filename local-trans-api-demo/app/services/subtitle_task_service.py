"""Unified async subtitle-task service: queue, worker, persistence, files."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import UploadFile
from fastapi.responses import FileResponse

from app.core.config import SUPPORTED_SUFFIXES, AppConfig
from app.core.errors import (
    EmptyFileError,
    FileTooLargeError,
    InvalidRequestError,
    ModelNotInstalledError,
    QueueFullError,
    ResultMissingError,
    ResultNotReadyError,
    TaskNotFoundError,
    UnsupportedFileError,
)
from app.core.state import AppState
from app.schemas.api import InferenceResult
from app.schemas.subtitle_tasks import (
    MODE_TO_PROFILE,
    SubtitleFormat,
    SubtitleMode,
    SubtitleTask,
    SubtitleTaskDownloads,
    SubtitleTaskResult,
    TaskError,
)
from app.services.inference_service import InferenceService
from app.services.subtitle_task_repository import SubtitleTaskRepository, TaskRow
from app.utils.subtitle import to_lrc, to_srt

logger = logging.getLogger("app.subtitle-tasks")

COPY_CHUNK_BYTES = 1024 * 1024
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._\-\u4e00-\u9fff]")
TASK_ID_RE = re.compile(r"^[0-9a-f]{32}$")

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _mkdir_task_dir(task_dir: Path) -> None:
    task_dir.mkdir(parents=True, exist_ok=True)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def sanitize_download_stem(original_name: str, max_len: int = 80) -> str:
    stem = Path(original_name).stem.strip() or "subtitle"
    stem = re.sub(r"[\x00-\x1f\x7f]", "", stem)
    stem = stem.replace("/", "").replace("\\", "")
    stem = stem.strip().strip(".")
    if not stem:
        stem = "subtitle"
    if len(stem) > max_len:
        stem = stem[:max_len].rstrip().rstrip(".") or "subtitle"
    return stem


class SubtitleTaskService:
    """Owns the subtitle-task queue, background worker, and file layout."""

    def __init__(
        self,
        config: AppConfig,
        state: AppState,
        inference: InferenceService,
        repository: SubtitleTaskRepository | None = None,
    ):
        self.config = config
        self.state = state
        self.inference = inference
        settings = config.resolved_subtitle_tasks
        self.data_dir = settings.data_directory
        self.tasks_dir = self.data_dir / "subtitle-tasks"
        self.db_path = self.data_dir / "tasks.sqlite3"
        self.max_upload_bytes = settings.max_upload_bytes
        self.max_waiting = settings.max_waiting
        self.retention_days = settings.retention_days
        self.repository = repository or SubtitleTaskRepository(self.db_path)
        self._reserve_lock = asyncio.Lock()
        self._reserved = 0
        self._accepting = True
        self._worker: asyncio.Task | None = None
        self._cleanup_task: asyncio.Task | None = None
        self._stopping = asyncio.Event()
        self._download_guards: dict[str, asyncio.Lock] = {}
        self._download_guards_lock = asyncio.Lock()

    # -- lifecycle ------------------------------------------------------
    async def start(self) -> None:
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self._recover_stale)
        self._stopping.clear()
        self._accepting = True
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._worker_loop(), name="subtitle-tasks")
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(
                self._cleanup_loop(), name="subtitle-tasks-cleanup"
            )

    async def shutdown(self) -> None:
        self._accepting = False
        now = utc_now_iso()
        expires = self._expires_iso(now)
        try:
            await asyncio.to_thread(
                self.repository.fail_queued, now, expires
            )
        except Exception:
            logger.exception("Failed to fail queued tasks during shutdown")
        self._stopping.set()
        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except (asyncio.CancelledError, Exception):
                pass
            self._cleanup_task = None
        if self._worker is not None:
            try:
                await asyncio.wait_for(self._worker, timeout=3600)
            except asyncio.TimeoutError:
                logger.error("Subtitle worker did not finish within timeout")
            except (asyncio.CancelledError, Exception):
                pass
            self._worker = None

    def _recover_stale(self) -> None:
        now = utc_now_iso()
        expires = self._expires_iso(now)
        stale_ids = self.repository.mark_stale_as_failed(now, expires)
        for task_id in stale_ids:
            logger.warning("Marked stale subtitle task as failed: %s", task_id)
        cleaned = self._cleanup_expired_sync(now)
        if cleaned:
            logger.info("Startup cleanup removed %d expired subtitle tasks", cleaned)

    def _expires_iso(self, finished_iso: str) -> str:
        finished = _parse_iso(finished_iso) or datetime.now(timezone.utc)
        return (finished + timedelta(days=self.retention_days)).isoformat().replace(
            "+00:00", "Z"
        )

    # -- submit ---------------------------------------------------------
    async def submit(
        self, file: UploadFile | None, mode: SubtitleMode | str, content_length: int | None = None
    ) -> SubtitleTask:
        try:
            return await self._submit_inner(file, mode, content_length)
        finally:
            try:
                if file is not None:
                    await file.close()
            except Exception:
                pass

    async def _submit_inner(
        self, file: UploadFile | None, mode: SubtitleMode | str, content_length: int | None
    ) -> SubtitleTask:
        if not self._accepting:
            raise QueueFullError("服务正在关闭，不再接收新任务。")
        try:
            parsed_mode = SubtitleMode(mode) if not isinstance(mode, SubtitleMode) else mode
        except ValueError:
            raise InvalidRequestError(f"不支持的处理模式: {mode}") from None
        if file is None:
            raise UnsupportedFileError("没有上传文件。")
        original_name = (file.filename or "").strip()
        if not original_name:
            raise UnsupportedFileError("没有上传文件。")
        # Strip any client-side path; only the basename is meaningful.
        original_name = Path(original_name.replace("\\", "/")).name or original_name
        suffix = Path(original_name).suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            raise UnsupportedFileError(f"不支持的文件格式: {suffix or '(无扩展名)'}")
        profile_id = MODE_TO_PROFILE[parsed_mode]
        profile = self.config.profile(profile_id)
        if profile is None:
            raise InvalidRequestError(f"处理模式未配置: {parsed_mode.value}")
        if not self.state.engine.is_installed(profile.model_id):
            raise ModelNotInstalledError(f"模型尚未安装: {profile.model_id}")
        if content_length is not None and content_length > self.max_upload_bytes:
            raise FileTooLargeError(
                f"文件超过上限 ({self.max_upload_bytes} 字节)。"
            )

        task_id = uuid.uuid4().hex
        task_dir = self.tasks_dir / task_id
        input_path = task_dir / f"input{suffix}"

        async with self._reserve_lock:
            running, queued = await asyncio.to_thread(self.repository.count_active)
            if running + queued + self._reserved >= 1 + self.max_waiting:
                raise QueueFullError("等待队列已满，请稍后重试。")
            self._reserved += 1
        reserved = True
        try:
            await asyncio.to_thread(_mkdir_task_dir, task_dir)
            size = await self._save_upload(file, input_path)
            if size == 0:
                raise EmptyFileError("文件为空，请选择有效的音视频文件。")
            if size > self.max_upload_bytes:
                raise FileTooLargeError(
                    f"文件超过上限 ({self.max_upload_bytes} 字节)。"
                )
            now = utc_now_iso()
            row = TaskRow(
                id=task_id,
                mode=parsed_mode.value,
                original_name=original_name,
                input_suffix=suffix,
                status=STATUS_QUEUED,
                stage=STATUS_QUEUED,
                mock=int(self.state.engine.mock),
                created_at=now,
                started_at=None,
                finished_at=None,
                expires_at=None,
                error_code=None,
                error_detail=None,
            )
            await asyncio.to_thread(self.repository.create, row)
            async with self._reserve_lock:
                self._reserved -= 1
                reserved = False
            self._ensure_worker()
            stored = await asyncio.to_thread(self.repository.get, task_id)
            assert stored is not None
            return self._to_public(stored)
        except Exception:
            raise
        finally:
            if reserved:
                async with self._reserve_lock:
                    self._reserved -= 1
                await asyncio.to_thread(
                    shutil.rmtree, task_dir, True
                )

    async def _save_upload(self, file: UploadFile, target: Path) -> int:
        def _write() -> int:
            total = 0
            with target.open("wb") as handle:
                while True:
                    chunk = file.file.read(COPY_CHUNK_BYTES)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > self.max_upload_bytes:
                        # Keep writing state consistent: stop and report.
                        # Caller converts to FILE_TOO_LARGE and cleans up.
                        handle.flush()
                        return total
                    handle.write(chunk)
            return total

        return await asyncio.to_thread(_write)

    def _ensure_worker(self) -> None:
        if self._worker is None or self._worker.done():
            if not self._stopping.is_set():
                self._worker = asyncio.create_task(
                    self._worker_loop(), name="subtitle-tasks"
                )

    # -- queries --------------------------------------------------------
    async def get_task(self, task_id: str) -> SubtitleTask:
        self._validate_task_id(task_id)
        row = await asyncio.to_thread(self.repository.get, task_id)
        if row is None:
            raise TaskNotFoundError(f"任务不存在或已过期清理: {task_id}")
        return self._to_public(row)

    async def list_tasks(self, limit: int = 20, offset: int = 0) -> dict:
        if limit < 1 or limit > 100 or offset < 0:
            raise InvalidRequestError("分页参数非法: limit 取 1-100，offset 须 ≥ 0。")
        rows, total = await asyncio.to_thread(
            self.repository.list_recent, limit, offset
        )
        return {
            "tasks": [self._to_public(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    async def download_response(self, task_id: str, format: SubtitleFormat | str) -> FileResponse:
        try:
            parsed = format if isinstance(format, SubtitleFormat) else SubtitleFormat(format)
        except ValueError:
            raise InvalidRequestError(f"不支持的下载格式: {format}") from None
        self._validate_task_id(task_id)
        row = await asyncio.to_thread(self.repository.get, task_id)
        if row is None:
            raise TaskNotFoundError(f"任务不存在或已过期清理: {task_id}")
        if row.status != STATUS_SUCCEEDED:
            raise ResultNotReadyError("任务尚未成功，暂无可下载的字幕。")
        task_dir = self.tasks_dir / task_id
        filename = "subtitle.srt" if parsed == SubtitleFormat.SRT else "subtitle.lrc"
        source = task_dir / filename
        guard = await self._guard_for(task_id)
        async with guard:
            exists = await asyncio.to_thread(source.is_file)
            if not exists:
                raise ResultMissingError("任务产物缺失，请重新提交任务。")
            stem = sanitize_download_stem(row.original_name)
            tag = "ja" if row.mode == SubtitleMode.TRANSCRIBE.value else "zh"
            download_name = f"{stem}.{tag}.{parsed.value}"
            media_type = "application/x-subrip" if parsed == SubtitleFormat.SRT else "text/plain"
            return FileResponse(
                path=str(source),
                media_type=f"{media_type}; charset=utf-8",
                filename=download_name,
            )

    def _validate_task_id(self, task_id: str) -> None:
        if not TASK_ID_RE.match(task_id or ""):
            raise TaskNotFoundError(f"任务不存在或已过期清理: {task_id}")

    async def _guard_for(self, task_id: str) -> asyncio.Lock:
        async with self._download_guards_lock:
            guard = self._download_guards.get(task_id)
            if guard is None:
                guard = asyncio.Lock()
                self._download_guards[task_id] = guard
            return guard

    # -- worker ---------------------------------------------------------
    async def _worker_loop(self) -> None:
        while not self._stopping.is_set():
            row = await asyncio.to_thread(self.repository.oldest_queued)
            if row is None:
                # Idle: short sleep, wake on new submissions via _ensure_worker.
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                if self._stopping.is_set():
                    break
                continue
            await self._execute_one(row.id)

    async def _execute_one(self, task_id: str) -> None:
        row = await asyncio.to_thread(self.repository.get, task_id)
        if row is None or row.status != STATUS_QUEUED:
            return
        # Wait for the shared engine lock; stay queued while waiting.
        async with self.inference.wait_engine_slot():
            current = await asyncio.to_thread(self.repository.get, task_id)
            if current is None or current.status != STATUS_QUEUED:
                return
            started = utc_now_iso()
            await asyncio.to_thread(
                self.repository.update,
                task_id,
                **{"status": STATUS_RUNNING, "stage": "loading_model", "started_at": started},
            )
            try:
                await self._run_inference(task_id, current)
            except Exception as error:
                logger.exception("Subtitle task failed: %s", task_id)
                await self._mark_failed(task_id, *self._classify_error(error))

    async def _run_inference(self, task_id: str, row: TaskRow) -> None:
        task_dir = self.tasks_dir / task_id
        input_path = task_dir / f"input{row.input_suffix}"
        if not await asyncio.to_thread(input_path.is_file):
            await self._mark_failed(task_id, "INFERENCE_FAILED", "上传的媒体文件缺失，无法处理。")
            return
        profile_id = MODE_TO_PROFILE[SubtitleMode(row.mode)]
        await asyncio.to_thread(
            self.repository.update, task_id, **{"stage": "processing"}
        )
        try:
            result: InferenceResult = await self.inference._run_profile_holding_lock(
                profile_id, str(input_path)
            )
        except Exception as error:
            raise error
        await asyncio.to_thread(
            self.repository.update, task_id, **{"stage": "writing_output"}
        )
        try:
            await asyncio.to_thread(self._write_outputs_sync, task_dir, row, result)
        except Exception as error:
            logger.exception("Failed to write subtitle outputs for %s", task_id)
            await self._mark_failed(task_id, "OUTPUT_WRITE_FAILED", "字幕产物写入失败，请重试。")
            return
        finished = utc_now_iso()
        expires = self._expires_iso(finished)
        await asyncio.to_thread(
            self.repository.update,
            task_id,
            **{
                "status": STATUS_SUCCEEDED,
                "stage": "completed",
                "finished_at": finished,
                "expires_at": expires,
                "mock": int(result.mock),
                "error_code": None,
                "error_detail": None,
            },
        )
        await asyncio.to_thread(self._remove_input, task_dir, row.input_suffix)

    def _write_outputs_sync(
        self, task_dir: Path, row: TaskRow, result: InferenceResult
    ) -> None:
        payload = result.model_dump(mode="json", exclude_none=True)
        result_json = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        srt_text = to_srt(result.segments)
        lrc_text = to_lrc(result.segments)
        for name, text in (
            ("result.json", result_json),
            ("subtitle.srt", srt_text),
            ("subtitle.lrc", lrc_text),
        ):
            tmp_path = task_dir / f"{name}.tmp"
            final_path = task_dir / name
            tmp_path.write_text(text, encoding="utf-8", newline="\n")
            tmp_path.replace(final_path)

    def _remove_input(self, task_dir: Path, suffix: str) -> None:
        try:
            candidate = task_dir / f"input{suffix}"
            if candidate.is_file():
                candidate.unlink()
            # Remove any stray input.* leftovers for this task only.
            for child in task_dir.glob("input.*"):
                try:
                    if child.is_file():
                        child.unlink()
                except OSError:
                    logger.warning("Could not remove temp media %s", child)
        except OSError:
            logger.warning("Could not clean temp media in %s", task_dir, exc_info=True)

    def _classify_error(self, error: Exception) -> tuple[str, str]:
        from app.core.errors import (
            InferenceError,
            InvalidPathError,
            ModelLoadError,
            ModelNotInstalledError,
            UnknownModelError,
            UnknownProfileError,
        )

        message = str(error) or type(error).__name__
        # Never leak stack traces or absolute paths to API consumers.
        safe = message.split("\n")[0][:300]
        if isinstance(error, (ModelLoadError, UnknownModelError)):
            return "MODEL_LOAD_FAILED", f"模型加载失败: {safe}"
        if isinstance(error, ModelNotInstalledError):
            return "MODEL_LOAD_FAILED", f"模型尚未安装: {safe}"
        if isinstance(error, (UnknownProfileError, InvalidPathError)):
            return "INFERENCE_FAILED", f"推理失败: {safe}"
        if isinstance(error, InferenceError):
            return "INFERENCE_FAILED", f"推理失败: {safe}"
        code = getattr(error, "code", None)
        if isinstance(code, str) and code in {
            "MODEL_LOAD_FAILED",
            "INFERENCE_FAILED",
            "OUTPUT_WRITE_FAILED",
        }:
            return code, safe
        return "INFERENCE_FAILED", f"推理失败: {safe}"

    async def _mark_failed(self, task_id: str, code: str, detail: str) -> None:
        finished = utc_now_iso()
        expires = self._expires_iso(finished)
        await asyncio.to_thread(
            self.repository.update,
            task_id,
            **{
                "status": STATUS_FAILED,
                "stage": STATUS_FAILED,
                "finished_at": finished,
                "expires_at": expires,
                "error_code": code,
                "error_detail": detail,
            },
        )
        row = await asyncio.to_thread(self.repository.get, task_id)
        if row is not None:
            await asyncio.to_thread(
                self._remove_input, self.tasks_dir / task_id, row.input_suffix
            )

    # -- cleanup --------------------------------------------------------
    async def _cleanup_loop(self) -> None:
        while not self._stopping.is_set():
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=3600)
            except asyncio.TimeoutError:
                try:
                    await asyncio.to_thread(self._cleanup_expired_sync, utc_now_iso())
                except Exception:
                    logger.exception("Periodic subtitle-task cleanup failed")
                continue
            break

    async def cleanup_expired_now(self) -> int:
        return await asyncio.to_thread(self._cleanup_expired_sync, utc_now_iso())

    def _cleanup_expired_sync(self, now_iso: str) -> int:
        expired = self.repository.expired_terminal(now_iso)
        removed = 0
        for row in expired:
            task_dir = self.tasks_dir / row.id
            try:
                if task_dir.exists():
                    # Avoid deleting a file a download is actively reading on
                    # Windows: retry once after a short wait instead of failing.
                    try:
                        shutil.rmtree(task_dir)
                    except OSError:
                        import time as _time

                        _time.sleep(0.2)
                        shutil.rmtree(task_dir)
                self.repository.delete(row.id)
                removed += 1
            except Exception:
                logger.exception(
                    "Failed to clean expired subtitle task %s; will retry", row.id
                )
                continue
        # Drop stale download guards to bound memory.
        for task_id in [key for key in self._download_guards]:
            if self.repository.get(task_id) is None:
                self._download_guards.pop(task_id, None)
        return removed

    # -- views ----------------------------------------------------------
    def _to_public(self, row: TaskRow) -> SubtitleTask:
        result: SubtitleTaskResult | None = None
        downloads: SubtitleTaskDownloads | None = None
        if row.status == STATUS_SUCCEEDED:
            payload = self._read_result_json(row.id)
            if payload is not None:
                try:
                    result = SubtitleTaskResult(
                        model=str(payload.get("model", "")),
                        text=str(payload.get("text", "")),
                        duration=float(payload.get("duration", 0.0)),
                        processing_time=float(payload.get("processing_time", 0.0)),
                    )
                    downloads = SubtitleTaskDownloads(
                        srt=f"/api/subtitle-tasks/{row.id}/file?format=srt",
                        lrc=f"/api/subtitle-tasks/{row.id}/file?format=lrc",
                    )
                except (TypeError, ValueError):
                    result = None
                    downloads = None
        error = None
        if row.status == STATUS_FAILED and row.error_code:
            error = TaskError(
                code=row.error_code, detail=row.error_detail or "任务失败。"
            )
        return SubtitleTask(
            id=row.id,
            mode=SubtitleMode(row.mode),
            status=row.status,
            stage=row.stage,
            original_name=row.original_name,
            mock=bool(row.mock),
            created_at=row.created_at,
            finished_at=row.finished_at,
            expires_at=row.expires_at,
            result=result,
            downloads=downloads,
            error=error,
        )

    def _read_result_json(self, task_id: str) -> dict | None:
        path = self.tasks_dir / task_id / "result.json"
        try:
            if not path.is_file():
                return None
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
