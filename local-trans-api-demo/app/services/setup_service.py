"""Environment probe and background model download for the acceptance page.

Nothing here runs shell commands: the only side effect is a
``huggingface_hub`` download of a model id that already exists in
``MODEL_CATALOG``.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import os
import shutil
import time
from pathlib import Path

from app.core.config import (
    CONFIG_PATH,
    MODEL_CATALOG,
    REQUIRED_MODEL_FILES,
    AppConfig,
    model_dir_is_complete,
)
from app.core.errors import DownloadBusyError, UnknownModelError

logger = logging.getLogger("app.setup")

DEFAULT_ENDPOINT = "https://huggingface.co"


def _importable(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _cuda_device_count() -> int:
    if not _importable("ctranslate2"):
        return 0
    try:
        import ctranslate2

        return int(ctranslate2.get_cuda_device_count())
    except Exception:  # a broken CUDA stack must not break the probe
        return 0


def _fetched_bytes(root: Path) -> int:
    """Bytes actually pulled: finished files plus in-flight partials.

    huggingface_hub hardlinks completed files into ``.cache``, so counting that
    tree as well would report roughly double the real size.
    """
    if not root.is_dir():
        return 0
    total = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root).parts
        if ".cache" in relative and path.suffix != ".incomplete":
            continue
        total += path.stat().st_size
    return total


class DownloadJob:
    def __init__(self, model_id: str, directory: Path, endpoint: str):
        self.model_id = model_id
        self.directory = directory
        self.endpoint = endpoint
        self.state = "running"
        self.error = ""
        self.total_bytes = 0
        self.started = time.perf_counter()
        self.finished = 0.0

    @property
    def elapsed(self) -> float:
        return (self.finished or time.perf_counter()) - self.started

    def snapshot(self) -> dict:
        downloaded = _fetched_bytes(self.directory)
        seconds = max(self.elapsed, 0.001)
        if self.total_bytes:
            downloaded = min(downloaded, self.total_bytes)
        return {
            "model_id": self.model_id,
            "state": self.state,
            "directory": str(self.directory),
            "endpoint": self.endpoint,
            "downloaded_bytes": downloaded,
            "total_bytes": self.total_bytes,
            "bytes_per_second": round(downloaded / seconds),
            "seconds": round(self.elapsed, 1),
            "error": self.error,
            "installed": model_dir_is_complete(self.directory),
        }


class SetupService:
    def __init__(self, config: AppConfig):
        self.config = config
        self.job: DownloadJob | None = None
        self._task: asyncio.Task | None = None

    def model_directory(self, model_id: str) -> Path:
        return self.config.models_directory / model_id

    def env(self) -> dict:
        models = []
        for model_id, meta in MODEL_CATALOG.items():
            directory = self.model_directory(model_id)
            models.append(
                {
                    "id": model_id,
                    "name": meta["name"],
                    "type": meta["type"],
                    "repo_id": meta["repo_id"],
                    "installed": model_dir_is_complete(directory),
                    "missing_files": [
                        name
                        for name in REQUIRED_MODEL_FILES
                        if not (directory / name).is_file()
                    ],
                    "bytes_on_disk": _fetched_bytes(directory),
                }
            )

        probe_root = (
            self.config.models_directory
            if self.config.models_directory.exists()
            else self.config.models_directory.parent
        )
        return {
            "config_path": str(CONFIG_PATH),
            "engine": self.config.engine,
            "device": self.config.faster_whisper.device,
            "compute_type": self.config.faster_whisper.compute_type,
            "models_directory": str(self.config.models_directory),
            "ai_dependencies": {
                name: _importable(name)
                for name in ("faster_whisper", "ctranslate2", "huggingface_hub")
            },
            "cuda_devices": _cuda_device_count(),
            "hf_endpoint": os.environ.get("HF_ENDPOINT") or DEFAULT_ENDPOINT,
            "disk_free_bytes": shutil.disk_usage(probe_root).free,
            "models": models,
            "install_command": ".venv\\Scripts\\pip install -r requirements-ai.txt",
        }

    async def start_download(self, model_id: str, endpoint: str = "") -> dict:
        if model_id not in MODEL_CATALOG:
            raise UnknownModelError(f"Unknown model: {model_id}")
        if self.job and self.job.state == "running":
            raise DownloadBusyError(
                f"Already downloading {self.job.model_id}; wait for it to finish."
            )

        job = DownloadJob(
            model_id,
            self.model_directory(model_id),
            (endpoint or os.environ.get("HF_ENDPOINT") or DEFAULT_ENDPOINT).rstrip("/"),
        )
        self.job = job
        self._task = asyncio.create_task(self._run(job))
        logger.info("Downloading %s from %s", model_id, job.endpoint)
        return job.snapshot()

    def progress(self) -> dict:
        if self.job is None:
            return {"state": "idle"}
        return self.job.snapshot()

    async def _run(self, job: DownloadJob) -> None:
        try:
            await asyncio.to_thread(self._download, job)
        except Exception as error:
            job.state = "failed"
            job.error = f"{type(error).__name__}: {str(error)[:200]}"
            logger.exception("Download failed for %s", job.model_id)
        finally:
            job.finished = time.perf_counter()
            if job.state == "running":
                if model_dir_is_complete(job.directory):
                    job.state = "done"
                    job.total_bytes = _fetched_bytes(job.directory)
                else:
                    job.state = "failed"
                    job.error = "download finished but the model is still incomplete"

    def _download(self, job: DownloadJob) -> None:
        from huggingface_hub import HfApi, snapshot_download

        api = HfApi(endpoint=job.endpoint)
        repository = MODEL_CATALOG[job.model_id]["repo_id"]
        try:
            info = api.model_info(repository, files_metadata=True)
            job.total_bytes = sum(file.size or 0 for file in info.siblings)
        except Exception:  # a missing denominator must not block the download
            logger.warning("Could not read file sizes for %s", repository)

        job.directory.mkdir(parents=True, exist_ok=True)
        snapshot_download(repo_id=repository, local_dir=str(job.directory), endpoint=job.endpoint)
