from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.schemas.api import InferenceRequest, InferenceResult
from app.services.inference_service import InferenceService

router = APIRouter(prefix="/api", tags=["inference"])

TRANSCRIBE_PROFILE = "ja-transcribe"
TRANSLATE_PROFILE = "ja-zh"


def get_service(request: Request) -> InferenceService:
    return request.app.state.service


# exclude_none keeps transcription free of source/target_language and
# translation free of language, with one shared schema for both.
@router.post(
    "/transcribe",
    response_model=InferenceResult,
    response_model_exclude_none=True,
)
async def transcribe(
    body: InferenceRequest, service: InferenceService = Depends(get_service)
) -> InferenceResult:
    return await service.infer(TRANSCRIBE_PROFILE, body.path)


@router.post(
    "/translate-audio",
    response_model=InferenceResult,
    response_model_exclude_none=True,
)
async def translate_audio(
    body: InferenceRequest, service: InferenceService = Depends(get_service)
) -> InferenceResult:
    return await service.infer(TRANSLATE_PROFILE, body.path)
