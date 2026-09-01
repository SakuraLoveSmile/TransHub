from __future__ import annotations

from app.schemas.v1 import TranscriptionResult


class TranscriptionProvider:
    """Boundary for a future transcription implementation."""

    async def transcribe(self, path: str, language: str) -> TranscriptionResult:
        raise NotImplementedError
