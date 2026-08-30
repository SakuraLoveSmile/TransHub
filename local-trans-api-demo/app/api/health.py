from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.api import HealthResponse, StatusResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/status", response_model=StatusResponse)
async def status(request: Request) -> StatusResponse:
    engine = request.app.state.engine
    return StatusResponse(
        status="running" if engine.busy else "idle",
        engine=engine.name,
        mock=engine.mock,
        loaded_model=engine.loaded_model,
        device=engine.device,
    )
