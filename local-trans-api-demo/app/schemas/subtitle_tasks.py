"""Public request/response types for the unified subtitle-task API."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class SubtitleMode(StrEnum):
    TRANSCRIBE = "transcribe"
    TRANSLATE = "translate"


class SubtitleFormat(StrEnum):
    SRT = "srt"
    LRC = "lrc"


class TaskError(BaseModel):
    code: str
    detail: str


class SubtitleTaskResult(BaseModel):
    model: str
    text: str
    duration: float
    processing_time: float


class SubtitleTaskDownloads(BaseModel):
    srt: str
    lrc: str


class SubtitleTask(BaseModel):
    id: str
    mode: SubtitleMode
    status: str
    stage: str
    original_name: str
    mock: bool
    created_at: str
    finished_at: str | None = None
    expires_at: str | None = None
    result: SubtitleTaskResult | None = None
    downloads: SubtitleTaskDownloads | None = None
    error: TaskError | None = None


class SubtitleTaskList(BaseModel):
    tasks: list[SubtitleTask]
    total: int
    limit: int
    offset: int


MODE_TO_PROFILE = {
    SubtitleMode.TRANSCRIBE: "ja-transcribe",
    SubtitleMode.TRANSLATE: "ja-zh",
}
