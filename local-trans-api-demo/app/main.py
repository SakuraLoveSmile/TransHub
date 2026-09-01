from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.health import router as health_router
from app.api.inference import router as inference_router
from app.api.models import router as models_router
from app.api.output import router as output_router
from app.api.setup import router as setup_router
from app.api.status import router as status_router
from app.api.v1 import router as v1_router
from app.config import Settings
from app.core.config import BASE_DIR, AppConfig, load_config
from app.core.errors import AppError, V1APIError
from app.core.state import AppState
from app.engines.base import BaseInferenceEngine
from app.engines.faster_whisper_engine import FasterWhisperEngine
from app.engines.mock_engine import MockEngine
from app.providers.mock.transcription import MockTranscriptionProvider
from app.providers.mock.translation import MockTranslationProvider
from app.providers.transcription import TranscriptionProvider
from app.providers.translation import TranslationProvider
from app.schemas.v1 import ErrorInfo, ErrorResponse
from app.services.inference_service import InferenceService
from app.services.setup_service import SetupService
from app.services.task_store import TaskStore
from app.services.transcription_service import TranscriptionService

LOGGER = logging.getLogger("transferhub")


def create_app(
    settings: Settings | None = None,
    transcription_provider: TranscriptionProvider | None = None,
    translation_provider: TranslationProvider | None = None,
) -> FastAPI:
    """Create the HTTP application and its default provider instances."""
    app_settings = settings or Settings.from_environment()
    configure_logging(app_settings)

    compatibility_config = replace(
        load_config(), host=app_settings.host, port=app_settings.port
    )
    compatibility_engine = create_engine(
        compatibility_config.engine, compatibility_config
    )
    compatibility_state = AppState(config=compatibility_config, engine=compatibility_engine)
    compatibility_service = InferenceService(compatibility_state)

    try:
        transcription = (
            transcription_provider
            if transcription_provider is not None
            else MockTranscriptionProvider(
                delay_seconds=app_settings.mock_transcription_delay,
                should_fail=app_settings.mock_transcription_fail,
            )
        )
        translation = (
            translation_provider
            if translation_provider is not None
            else MockTranslationProvider()
        )
    except Exception:
        LOGGER.exception("Provider initialization failed")
        raise

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        LOGGER.info(
            "TransferHub started host=%s port=%s",
            app_settings.host,
            app_settings.port,
        )
        try:
            yield
        finally:
            await transcription_service.shutdown()
            LOGGER.info("TransferHub stopped")

    task_store = TaskStore()
    transcription_service = TranscriptionService(
        provider=transcription,
        task_store=task_store,
    )
    application = FastAPI(
        title="TransferHub",
        version=__version__,
        description="Windows local transcription and translation API hub.",
        lifespan=lifespan,
    )
    application.state.settings = app_settings
    application.state.transcription_provider = transcription
    application.state.translation_provider = translation
    application.state.task_store = task_store
    application.state.transcription_service = transcription_service
    application.state.config = compatibility_config
    application.state.engine = compatibility_engine
    application.state.service = compatibility_service
    application.state.setup = SetupService(compatibility_config)

    application.add_exception_handler(AppError, handle_app_error)
    application.add_exception_handler(V1APIError, handle_v1_api_error)
    application.add_exception_handler(
        RequestValidationError, handle_request_validation_error
    )
    application.include_router(health_router)
    application.include_router(status_router)
    application.include_router(models_router)
    application.include_router(inference_router)
    application.include_router(output_router)
    application.include_router(setup_router)
    application.include_router(v1_router)
    application.mount(
        "/",
        StaticFiles(directory=Path(BASE_DIR) / "static", html=True),
        name="static",
    )
    return application


def create_engine(name: str, config: AppConfig) -> BaseInferenceEngine:
    if name == "mock":
        return MockEngine(config)
    if name == "faster-whisper":
        return FasterWhisperEngine(config)
    raise RuntimeError(f"Unknown engine: {name}")


async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "detail": exc.detail},
    )


async def handle_v1_api_error(_: Request, exc: V1APIError) -> JSONResponse:
    response = ErrorResponse(
        error=ErrorInfo(code=exc.code, message=exc.message, details=exc.details)
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=response.model_dump(mode="json"),
    )


async def handle_request_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    if not request.url.path.startswith("/v1/"):
        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(exc.errors())},
        )

    details = [
        {
            "loc": list(error["loc"]),
            "msg": error["msg"],
            "type": error["type"],
        }
        for error in exc.errors()
    ]
    response = ErrorResponse(
        error=ErrorInfo(
            code="INVALID_REQUEST",
            message="Request is invalid.",
            details=details,
        )
    )
    return JSONResponse(status_code=422, content=response.model_dump(mode="json"))


def configure_logging(settings: Settings) -> None:
    level = getattr(logging, settings.log_level)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    LOGGER.setLevel(level)


settings = Settings.from_environment()
app = create_app(settings)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )
