from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.api import (
    LoadModelResponse,
    ModelLoadRequest,
    ModelsResponse,
    UnloadModelResponse,
)

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=ModelsResponse)
async def list_models(request: Request) -> ModelsResponse:
    return ModelsResponse(models=request.app.state.engine.list_models())


@router.post("/load", response_model=LoadModelResponse)
async def load_model(body: ModelLoadRequest, request: Request) -> LoadModelResponse:
    await request.app.state.service.load_model(body.model)
    engine = request.app.state.engine
    return LoadModelResponse(success=True, loaded_model=engine.loaded_model, mock=engine.mock)


@router.post("/unload", response_model=UnloadModelResponse)
async def unload_model(request: Request) -> UnloadModelResponse:
    await request.app.state.service.unload_model()
    return UnloadModelResponse(success=True, loaded_model=request.app.state.engine.loaded_model)
