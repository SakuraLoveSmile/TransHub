from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import health, inference, models, output, setup
from app.core.config import BASE_DIR, AppConfig, load_config
from app.core.errors import AppError
from app.core.state import AppState
from app.engines.base import BaseInferenceEngine
from app.engines.faster_whisper_engine import FasterWhisperEngine
from app.engines.mock_engine import MockEngine
from app.services.inference_service import InferenceService
from app.services.setup_service import SetupService

# Local path API must not be exposed directly to LAN/WAN: bind to 127.0.0.1.
LOCALHOST = "127.0.0.1"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("app")


def create_engine(name: str, config: AppConfig) -> BaseInferenceEngine:
    if name == "mock":
        return MockEngine(config)
    if name == "faster-whisper":
        return FasterWhisperEngine(config)
    raise RuntimeError(f"Unknown engine: {name}")


app = FastAPI(
    title="Local Trans API Demo",
    version=__version__,
    description=(
        "Local transcription / speech-translation API demo. "
        "Local path API must not be exposed directly to LAN/WAN."
    ),
)


@app.exception_handler(AppError)
async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    logger.error("%s %s failed: %s", request.method, request.url.path, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


config = load_config()
engine = create_engine(config.engine, config)
state = AppState(config=config, engine=engine)

app.state.config = config
app.state.engine = engine
app.state.service = InferenceService(state)
app.state.setup = SetupService(config)

if config.host != LOCALHOST:
    logger.warning(
        "Binding to %s; a local path API should stay on %s.", config.host, LOCALHOST
    )

app.include_router(health.router)
app.include_router(models.router)
app.include_router(inference.router)
app.include_router(output.router)
app.include_router(setup.router)
app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")

logger.info("Engine=%s output=%s", config.engine, config.output_directory)
