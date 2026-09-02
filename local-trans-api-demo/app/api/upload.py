"""Browser upload endpoint: saves a local media file onto the server disk.

The web UI cannot see absolute paths (browser and server run on the same
machine), so "pick a local file" is implemented as POST /api/upload followed by
the normal /api/transcribe round-trip. Files are stored under
``[upload] directory`` with a UUID-prefixed, sanitized name.
"""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile

from app.core.config import SUPPORTED_SUFFIXES
from app.core.errors import InvalidPathError, UnsupportedFileError
from app.schemas.api import UploadResponse

router = APIRouter(prefix="/api", tags=["upload"])

SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._-]")
FALLBACK_STEM = "upload"
COPY_CHUNK_BYTES = 1024 * 1024


@router.post("/upload", response_model=UploadResponse)
async def upload(
    request: Request, file: UploadFile | None = File(None)
) -> UploadResponse:
    if file is None:
        raise UnsupportedFileError("No file uploaded")
    original = file.filename or ""
    candidate = Path(original)
    suffix = candidate.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise UnsupportedFileError(
            f"Unsupported file type: {suffix or '(no extension)'}"
        )

    upload_directory = request.app.state.config.upload_directory
    upload_directory.mkdir(parents=True, exist_ok=True)

    safe_stem = SAFE_STEM_RE.sub("", candidate.stem) or FALLBACK_STEM
    name = f"{uuid.uuid4().hex}-{safe_stem}{suffix}"
    target = upload_directory / name
    with target.open("wb") as handle:
        shutil.copyfileobj(file.file, handle, length=COPY_CHUNK_BYTES)

    resolved = target.resolve()
    if resolved.parent != upload_directory.resolve():
        raise InvalidPathError(f"Upload escaped its directory: {name}")

    return UploadResponse(path=str(resolved), name=name)