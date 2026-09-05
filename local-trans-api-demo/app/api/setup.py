from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.api import DownloadRequest

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/env")
async def environment(request: Request) -> dict:
    return request.app.state.setup.env()


@router.get("/preflight")
async def preflight(request: Request) -> dict:
    return request.app.state.setup.preflight()


@router.get("/download")
async def download_progress(request: Request) -> dict:
    return request.app.state.setup.progress()


@router.post("/download")
async def start_download(body: DownloadRequest, request: Request) -> dict:
    return await request.app.state.setup.start_download(body.model, body.endpoint)
