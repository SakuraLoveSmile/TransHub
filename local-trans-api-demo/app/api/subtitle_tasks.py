"""Unified async subtitle-task HTTP surface."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse

from app.schemas.subtitle_tasks import (
    SubtitleFormat,
    SubtitleMode,
    SubtitleTask,
    SubtitleTaskList,
)

router = APIRouter(prefix="/api/subtitle-tasks", tags=["subtitle-tasks"])


def get_tasks(request: Request):
    service = getattr(request.app.state, "subtitle_tasks", None)
    if service is None:
        from app.core.errors import TaskNotFoundError

        raise TaskNotFoundError("字幕任务服务尚未初始化。")
    return service


@router.post("", status_code=202, response_model=SubtitleTask)
async def create_task(
    request: Request,
    file: Annotated[UploadFile, File()],
    mode: Annotated[SubtitleMode, Form()],
    tasks=Depends(get_tasks),
) -> SubtitleTask:
    content_length = None
    raw = request.headers.get("content-length")
    if raw and raw.isdigit():
        content_length = int(raw)
    return await tasks.submit(file=file, mode=mode, content_length=content_length)


@router.get("", response_model=SubtitleTaskList)
async def list_tasks(
    limit: int = 20,
    offset: int = 0,
    tasks=Depends(get_tasks),
) -> SubtitleTaskList:
    body = await tasks.list_tasks(limit=limit, offset=offset)
    return SubtitleTaskList(**body)


@router.get("/{task_id}", response_model=SubtitleTask)
async def get_task(task_id: str, tasks=Depends(get_tasks)) -> SubtitleTask:
    return await tasks.get_task(task_id)


@router.get("/{task_id}/file")
async def download_file(
    task_id: str,
    format: SubtitleFormat = SubtitleFormat.SRT,
    tasks=Depends(get_tasks),
) -> FileResponse:
    return await tasks.download_response(task_id, format)
