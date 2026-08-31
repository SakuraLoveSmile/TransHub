from __future__ import annotations

from fastapi import APIRouter, Request

from app import __version__
from app.schemas.api import StatusResponse
from app.schemas.health import HealthResponse, LegacyHealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="transferhub", version=__version__)


@router.get("/api/health", response_model=LegacyHealthResponse)
async def legacy_health() -> LegacyHealthResponse:
    return LegacyHealthResponse(status="ok")


@router.get("/api/status", response_model=StatusResponse)
async def status(request: Request) -> StatusResponse:
    engine = request.app.state.engine
    return StatusResponse(
        status="running" if engine.busy else "idle",
        engine=engine.name,
        mock=engine.mock,
        loaded_model=engine.loaded_model,
        device=engine.device,
    )
