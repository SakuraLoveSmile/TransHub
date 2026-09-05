from __future__ import annotations

from collections.abc import Iterable

from app.schemas.api import Segment


def format_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def to_srt(segments: Iterable[Segment]) -> str:
    blocks = [
        f"{index}\n{format_timestamp(segment.start)} --> {format_timestamp(segment.end)}\n{segment.text}"
        for index, segment in enumerate(segments, start=1)
    ]
    return "\n\n".join(blocks) + "\n" if blocks else ""


def to_lrc(segments: Iterable[Segment]) -> str:
    """Render ``segments`` as LRC.

    One line per segment using the segment start time only. LRC expresses
    hundredths of a second; the value is rounded as a whole first so the
    carry into seconds/minutes is correct. Minutes may exceed 59. No end
    time and no karaoke word timing are claimed.
    """
    lines: list[str] = []
    for segment in segments:
        text = " ".join(segment.text.split())
        if not text:
            continue
        centiseconds = max(0, int(segment.start * 100 + 0.5))
        minutes, remainder = divmod(centiseconds, 6000)
        seconds, fraction = divmod(remainder, 100)
        lines.append(f"[{minutes:02d}:{seconds:02d}.{fraction:02d}]{text}")
    return "\n".join(lines) + "\n" if lines else ""
