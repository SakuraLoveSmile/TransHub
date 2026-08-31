from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class HealthV1Response(BaseModel):
    status: str
    service: str
    version: str


class FileInput(BaseModel):
    type: str = "file"
    path: str


class TranscriptionRequest(BaseModel):
    input: FileInput
    language: str = "auto"


class TaskInfo(BaseModel):
    id: str
    type: str
    status: str
    created_at: datetime
    updated_at: datetime


class TaskCreateResponse(BaseModel):
    task: TaskInfo


class Segment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionResult(BaseModel):
    text: str
    language: str | None = None
    segments: list[Segment] = Field(default_factory=list)


class ErrorInfo(BaseModel):
    code: str
    message: str
    details: dict | None = None


class TaskResponse(BaseModel):
    id: str
    type: str
    status: str
    created_at: datetime
    updated_at: datetime
    result: TranscriptionResult | None = None
    error: ErrorInfo | None = None


class TaskQueryResponse(BaseModel):
    task: TaskResponse


class TranslationRequest(BaseModel):
    text: str
    source_language: str = "auto"
    target_language: str


class TranslationResult(BaseModel):
    text: str
    source_language: str
    target_language: str


class TranslationResponse(BaseModel):
    translation: TranslationResult
