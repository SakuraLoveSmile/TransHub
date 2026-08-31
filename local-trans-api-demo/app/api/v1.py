from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.schemas.v1 import (
    TaskCreateResponse,
    TaskInfo,
    TranslationRequest,
    TranslationResponse,
    TranslationResult,
    TranscriptionRequest,
)

router = APIRouter(prefix="/v1", tags=["v1"])


@router.post("/transcriptions", response_model=TaskCreateResponse, status_code=202)
async def create_transcription(request: TranscriptionRequest) -> TaskCreateResponse:
    now = datetime.now(timezone.utc)
    return TaskCreateResponse(
        task=TaskInfo(
            id="tsk_mock_contract_only",
            type="transcription",
            status="queued",
            created_at=now,
            updated_at=now,
        )
    )


@router.post("/translations", response_model=TranslationResponse)
async def create_translation(request: TranslationRequest) -> TranslationResponse:
    return TranslationResponse(
        translation=TranslationResult(
            text=request.text,
            source_language=request.source_language,
            target_language=request.target_language,
        )
    )
