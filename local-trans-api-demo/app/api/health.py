from fastapi import APIRouter

from app import __version__
from app.schemas.health import HealthResponse, LegacyHealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="transferhub", version=__version__)


@router.get("/api/health", response_model=LegacyHealthResponse)
async def legacy_health() -> LegacyHealthResponse:
    return LegacyHealthResponse(status="ok")
