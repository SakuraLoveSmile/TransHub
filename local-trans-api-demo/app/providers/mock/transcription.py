from __future__ import annotations

import asyncio
import math

from app.providers.transcription import TranscriptionProvider
from app.schemas.v1 import TranscriptionResult, TranscriptionSegment

MOCK_TRANSCRIPTION_TEXT = "This is a mock transcription."
MOCK_TRANSCRIPTION_LANGUAGE = "en"


class MockTranscriptionProvider(TranscriptionProvider):
    """Return deterministic transcription data without reading the media file."""

    def __init__(
        self,
        *,
        delay_seconds: float = 0.2,
        should_fail: bool = False,
    ) -> None:
        if not math.isfinite(delay_seconds) or delay_seconds < 0:
            raise ValueError("delay_seconds must be a finite number >= 0")
        self.delay_seconds = delay_seconds
        self.should_fail = should_fail

    async def transcribe(self, path: str, language: str) -> TranscriptionResult:
        del path
        await asyncio.sleep(self.delay_seconds)
        if self.should_fail:
            raise RuntimeError("mock transcription failed")

        result_language = language.strip()
        if not result_language or result_language == "auto":
            result_language = MOCK_TRANSCRIPTION_LANGUAGE
        return TranscriptionResult(
            text=MOCK_TRANSCRIPTION_TEXT,
            language=result_language,
            segments=[
                TranscriptionSegment(
                    start=0.0,
                    end=2.0,
                    text=MOCK_TRANSCRIPTION_TEXT,
                )
            ],
        )
