"""Download CTranslate2 models into models/<model_id> for Phase 2+.

Mock mode never needs this script.

    .venv\\Scripts\\python scripts\\download_models.py
    .venv\\Scripts\\python scripts\\download_models.py --model chickenrice-v2
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import BASE_DIR, load_config  # noqa: E402

REPOSITORIES = {
    "whisper-ja-1.5b": "TransWithAI/whisper-ja-1.5B-ct2",
    "chickenrice-v2": "chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2",
}


def download(model_id: str, target: Path) -> bool:
    from huggingface_hub import snapshot_download

    if target.exists() and any(target.iterdir()):
        print(f"[skip] {model_id} already present at {target}")
        return True

    repository = REPOSITORIES[model_id]
    print(f"[download] {repository} -> {target}")
    target.mkdir(parents=True, exist_ok=True)
    try:
        snapshot_download(repo_id=repository, local_dir=str(target))
    except Exception as error:  # noqa: BLE001 - report the real hub failure reason
        print(f"[fail] {model_id}: {type(error).__name__}: {error}", file=sys.stderr)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        action="append",
        choices=sorted(REPOSITORIES),
        help="model id to download (repeatable); defaults to all",
    )
    parser.add_argument(
        "--directory",
        default=None,
        help="target models directory (default: [models] in config.toml)",
    )
    args = parser.parse_args()

    models_directory = (
        Path(args.directory) if args.directory else load_config().models_directory
    )
    models_directory = (
        models_directory
        if models_directory.is_absolute()
        else BASE_DIR / models_directory
    )

    selected = args.model or list(REPOSITORIES)
    failed = [
        model_id
        for model_id in selected
        if not download(model_id, models_directory / model_id)
    ]
    if failed:
        print(f"[fail] incomplete models: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"[done] models ready at {models_directory}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ImportError:
        print(
            "[fail] huggingface-hub is missing. Run: "
            ".venv\\Scripts\\pip install -r requirements-ai.txt",
            file=sys.stderr,
        )
        raise SystemExit(2)
