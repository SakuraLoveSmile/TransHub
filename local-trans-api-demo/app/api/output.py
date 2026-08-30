from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from app.core.errors import InvalidPathError, OutputNotFoundError

router = APIRouter(prefix="/api/output", tags=["output"])

# Only the demo's own subtitle / result artifacts, addressed by bare filename.
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(json|srt)$")

MEDIA_TYPES = {".json": "application/json", ".srt": "text/plain; charset=utf-8"}


def resolve_artifact(output_directory: Path, name: str) -> Path:
    if not NAME_RE.match(name):
        raise InvalidPathError(f"Invalid output name: {name}")
    directory = output_directory.resolve()
    path = (directory / name).resolve()
    if path.parent != directory:
        raise InvalidPathError(f"Invalid output name: {name}")
    if not path.is_file():
        raise OutputNotFoundError(f"Output file not found: {name}")
    return path


@router.get("/{name}")
async def read_output(name: str, request: Request) -> FileResponse:
    path = resolve_artifact(request.app.state.config.output_directory, name)
    return FileResponse(path, media_type=MEDIA_TYPES[path.suffix])
