"""Schemas for the stable local ``/api/*`` compatibility surface."""

from __future__ import annotations

from pydantic import BaseModel, field_validator


class InferenceRequest(BaseModel):
    path: str

    @field_validator("path")
    @classmethod
    def path_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("path must not be empty")
        return value


class Segment(BaseModel):
    start: float
    end: float
    text: str


class InferenceResult(BaseModel):
    success: bool
    mock: bool
    profile: str
    model: str
    duration: float
    processing_time: float
    realtime_factor: float
    speed: float
    text: str
    segments: list[Segment]
    language: str | None = None
    source_language: str | None = None
    target_language: str | None = None


class ModelLoadRequest(BaseModel):
    model: str

    @field_validator("model")
    @classmethod
    def model_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("model must not be empty")
        return value


class DownloadRequest(BaseModel):
    model: str
    endpoint: str = ""

    @field_validator("model")
    @classmethod
    def model_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("model must not be empty")
        return value


class ModelInfo(BaseModel):
    id: str
    name: str
    type: str
    installed: bool
    loaded: bool
    mock: bool


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


class LoadModelResponse(BaseModel):
    success: bool
    loaded_model: str | None
    mock: bool


class UnloadModelResponse(BaseModel):
    success: bool
    loaded_model: str | None


class StatusResponse(BaseModel):
    status: str
    engine: str
    mock: bool
    loaded_model: str | None = None
    device: str | None = None


class UploadResponse(BaseModel):
    path: str
    name: str
