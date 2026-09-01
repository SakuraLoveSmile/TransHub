"""Stable v1 API contract routes."""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.core.errors import V1APIError
from app.schemas.v1 import (
    ErrorResponse,
    TaskResponse,
    TranscriptionRequest,
    TranslationRequest,
    TranslationResponse,
    TranslationResult,
)

router = APIRouter(prefix="/v1", tags=["v1"])

V1_INVALID_REQUEST_RESPONSE = {422: {"model": ErrorResponse}}


@router.post(
    "/transcriptions",
    response_model=TaskResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_202_ACCEPTED,
    responses=V1_INVALID_REQUEST_RESPONSE,
)
async def create_transcription(
    request: TranscriptionRequest,
    http_request: Request,
) -> TaskResponse:
    """Validate a request, enqueue it, and return its initial task state."""
    task = http_request.app.state.transcription_service.submit(request)
    return TaskResponse(task=task)


@router.get(
    "/tasks/{task_id}",
    response_model=TaskResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_task(task_id: str, http_request: Request) -> TaskResponse:
    """Return the current state of an in-memory transcription task."""
    task = http_request.app.state.transcription_service.get_task(task_id)
    if task is None:
        raise V1APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="TASK_NOT_FOUND",
            message="Task not found.",
        )
    return TaskResponse(task=task)


@router.post(
    "/translations",
    response_model=TranslationResponse,
    responses=V1_INVALID_REQUEST_RESPONSE,
)
async def create_translation(request: TranslationRequest) -> TranslationResponse:
    """Return a deterministic translation contract stub without network access."""
    return TranslationResponse(
        translation=TranslationResult(
            text=f"[mock {request.target_language}] {request.text}",
            source_language=request.source_language,
            target_language=request.target_language,
        )
    )
