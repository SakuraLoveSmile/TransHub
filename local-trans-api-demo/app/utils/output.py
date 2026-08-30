from __future__ import annotations

import json
import re
from pathlib import Path

from app.schemas.api import InferenceResult
from app.utils.subtitle import to_srt

# Windows-style paths must work on a POSIX dev machine, so "/" and "\" are both
# treated as separators here instead of relying on Path semantics.
SEPARATORS = re.compile(r"[\\/]+")

OUTPUT_TAGS = {"transcribe": "transcribe", "translate": "zh"}


def media_basename(path: str) -> str:
    parts = [part for part in SEPARATORS.split(path.strip()) if part]
    if not parts:
        return "untitled"
    return Path(parts[-1]).stem or "untitled"


def write_outputs(
    result: InferenceResult,
    source_path: str,
    output_directory: Path,
    task: str,
) -> list[Path]:
    output_directory.mkdir(parents=True, exist_ok=True)
    stem = media_basename(source_path)
    tag = OUTPUT_TAGS.get(task, task)

    json_path = output_directory / f"{stem}.{tag}.json"
    srt_path = output_directory / f"{stem}.{tag}.srt"

    json_path.write_text(
        json.dumps(
            result.model_dump(mode="json", exclude_none=True),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    srt_path.write_text(to_srt(result.segments), encoding="utf-8")
    return [json_path, srt_path]
