"""Run inference in-process through InferenceService, without starting the API.

Examples:
    python scripts/test_inference.py --profile ja-transcribe --file "D:\\ASMR\\test.flac"
    python scripts/test_inference.py --profile ja-zh --file samples/track01.flac
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import load_config  # noqa: E402
from app.core.errors import AppError  # noqa: E402
from app.core.state import AppState  # noqa: E402
from app.main import create_engine  # noqa: E402
from app.services.inference_service import InferenceService  # noqa: E402

# Windows consoles default to a non-UTF-8 code page, which cannot print
# Japanese or Chinese transcripts.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


async def run(profile: str, file_path: str) -> int:
    config = load_config()
    engine = create_engine(config.engine, config)
    service = InferenceService(AppState(config=config, engine=engine))

    print(f"engine={config.engine} profile={profile} file={file_path}")
    result = await service.infer(profile, file_path)
    print(
        json.dumps(
            result.model_dump(mode="json", exclude_none=True),
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"output files written under {config.output_directory}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, help="profile id, e.g. ja-transcribe")
    parser.add_argument("--file", required=True, help="media path")
    args = parser.parse_args()

    try:
        return asyncio.run(run(args.profile, args.file))
    except AppError as error:
        print(f"{error.__class__.__name__} ({error.status_code}): {error.detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
