"""Stable request and response models for the TransferHub v1 API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

TaskStatus = Literal["queued", "running", "completed", "failed"]
TaskType = Literal["transcription"]
ErrorCode = Literal[
    "INVALID_REQUEST",
    "FILE_NOT_FOUND",
    "UNSUPPORTED_INPUT",
    "TASK_NOT_FOUND",
    "TRANSCRIPTION_FAILED",
    "TRANSLATION_FAILED",
    "PROVIDER_UNAVAILABLE",
    "INTERNAL_ERROR",
]


class TranscriptionInput(BaseModel):
    type: Literal["file"]
    path: str

    @field_validator("path")
    @classmethod
    def path_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("path must not be empty")
        return value


class TranscriptionRequest(BaseModel):
    input: TranscriptionInput
    language: str = "auto"


class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionResult(BaseModel):
    text: str
    language: str
    segments: list[TranscriptionSegment]


class ErrorInfo(BaseModel):
    code: ErrorCode
    message: str
    details: object | None = None


class ErrorResponse(BaseModel):
    error: ErrorInfo


class Task(BaseModel):
    id: str
    type: TaskType
    status: TaskStatus
    created_at: datetime
    updated_at: datetime
    result: TranscriptionResult | None = None
    error: ErrorInfo | None = None


class TaskResponse(BaseModel):
    task: Task


class TranslationRequest(BaseModel):
    text: str
    source_language: str
    target_language: str

    @field_validator("text", "source_language", "target_language")
    @classmethod
    def fields_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("field must not be empty")
        return value


class TranslationResult(BaseModel):
    text: str
    source_language: str
    target_language: str


class TranslationResponse(BaseModel):
    translation: TranslationResult
