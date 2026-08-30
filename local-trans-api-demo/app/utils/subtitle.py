from __future__ import annotations

from collections.abc import Iterable

from app.schemas.api import Segment


def format_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def to_srt(segments: Iterable[Segment]) -> str:
    blocks = [
        f"{index}\n"
        f"{format_timestamp(segment.start)} --> {format_timestamp(segment.end)}\n"
        f"{segment.text}"
        for index, segment in enumerate(segments, start=1)
    ]
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n"
