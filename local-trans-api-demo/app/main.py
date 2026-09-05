from __future__ import annotations

import logging
import time
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
from starlette.exceptions import HTTPException as StarletteHTTPException


from app import __version__
from app.api.health import router as health_router
from app.api.inference import router as inference_router
from app.api.models import router as models_router
from app.api.output import router as output_router
from app.api.setup import router as setup_router
from app.api.status import router as status_router
from app.api.subtitle_tasks import router as subtitle_tasks_router
from app.api.upload import router as upload_router
from app.api.v1 import router as v1_router
from app.config import Settings
from app.core.config import BASE_DIR, AppConfig, load_config
from app.core.errors import AppError, V1APIError
from app.core.preflight import run_preflight
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
    config: AppConfig | None = None,
) -> FastAPI:
    """Create the HTTP application and its default provider instances."""
    app_settings = settings or Settings.from_environment()
    configure_logging(app_settings)

    compatibility_config = replace(
        config or load_config(), host=app_settings.host, port=app_settings.port
    )
    preflight_report = None
    if compatibility_config.engine == "faster-whisper":
        preflight_report = run_preflight()
        if not preflight_report["ok"]:
            problems_str = "; ".join(preflight_report["problems"])
            hints_str = " | ".join(preflight_report["hints"])
            LOGGER.error("GPU Preflight failed: %s. Hints: %s", problems_str, hints_str)
            raise RuntimeError(
                f"GPU Preflight failed: {problems_str}. Actionable hints: {hints_str}"
            )
        devices = preflight_report.get("gpu", {}).get("devices", [])
        gpu_name = devices[0]["name"] if devices else "unknown"
        driver_ver = preflight_report.get("gpu", {}).get("driver_version") or "unknown"
        cuda_ver = preflight_report.get("gpu", {}).get("cuda_driver_version") or "unknown"
        LOGGER.info(
            "GPU Preflight passed: GPU=%s driver=%s CUDA=%s",
            gpu_name,
            driver_ver,
            cuda_ver,
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
            "TransferHub started host=%s port=%s engine=%s device=%s models_dir=%s output_dir=%s uploads_dir=%s",
            app_settings.host,
            app_settings.port,
            compatibility_config.engine,
            compatibility_engine.device,
            compatibility_config.models_directory,
            compatibility_config.output_directory,
            compatibility_config.upload_directory,
        )
        try:
            await subtitle_task_service.start()
        except Exception:
            LOGGER.exception("Failed to start subtitle-task service")
            raise
        try:
            yield
        finally:
            try:
                await subtitle_task_service.shutdown()
            except Exception:
                LOGGER.exception("Failed to shut down subtitle-task service")
            await transcription_service.shutdown()
            if hasattr(application.state, "setup") and application.state.setup:
                await application.state.setup.shutdown()
            try:
                await compatibility_engine.unload_model()
            except Exception:
                LOGGER.exception("Failed to unload model during shutdown")
            LOGGER.info("TransferHub stopped: shutdown complete")

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
    from app.services.subtitle_task_service import SubtitleTaskService

    subtitle_task_service = SubtitleTaskService(
        compatibility_config, compatibility_state, compatibility_service
    )
    application.state.subtitle_tasks = subtitle_task_service

    @application.middleware("http")
    async def log_api_requests(request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        started = time.perf_counter()
        try:
            response = await call_next(request)
            elapsed_ms = (time.perf_counter() - started) * 1000
            LOGGER.info(
                "%s %s -> %d (%.1fms)",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
            )
            return response
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000
            LOGGER.info(
                "%s %s -> 500 (%.1fms)",
                request.method,
                request.url.path,
                elapsed_ms,
            )
            raise

    application.add_exception_handler(AppError, handle_app_error)
    application.add_exception_handler(V1APIError, handle_v1_api_error)
    application.add_exception_handler(
        RequestValidationError, handle_request_validation_error
    )
    application.add_exception_handler(Exception, handle_unhandled_exception)
    application.include_router(health_router)
    application.include_router(status_router)
    application.include_router(models_router)
    application.include_router(inference_router)
    application.include_router(output_router)
    application.include_router(setup_router)
    application.include_router(upload_router)
    application.include_router(subtitle_tasks_router)
    application.include_router(v1_router)
    frontend_dist = Path(BASE_DIR) / "frontend" / "dist"
    if frontend_dist.is_dir() and (frontend_dist / "index.html").is_file():
        # Keep the legacy diagnostics page reachable when the Vue bundle
        # is hosted at "/": API routes match first, these two files second,
        # and the SPA fallback serves everything else.
        from fastapi.responses import FileResponse as _FileResponse

        static_dir = Path(BASE_DIR) / "static"

        @application.get("/diagnostics.html", include_in_schema=False)
        async def _diagnostics_page() -> _FileResponse:
            return _FileResponse(
                path=str(static_dir / "diagnostics.html"),
                media_type="text/html; charset=utf-8",
            )

        @application.get("/diagnostics.js", include_in_schema=False)
        async def _diagnostics_script() -> _FileResponse:
            return _FileResponse(
                path=str(static_dir / "diagnostics.js"),
                media_type="text/javascript; charset=utf-8",
            )

        application.mount(
            "/",
            StaticFiles(directory=frontend_dist, html=True),
            name="frontend",
        )
    else:
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
        if request.url.path.startswith("/api/subtitle-tasks"):
            first = exc.errors()[0] if exc.errors() else {}
            loc = ".".join(str(part) for part in first.get("loc", []))
            message = str(first.get("msg", "请求参数非法"))
            return JSONResponse(
                status_code=422,
                content={
                    "code": "INVALID_REQUEST",
                    "detail": f"请求参数非法 ({loc}): {message}"
                    if loc
                    else f"请求参数非法: {message}",
                },
            )
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
 
 
async def handle_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, StarletteHTTPException):
        raise exc
    LOGGER.exception(
        "Unhandled server exception on %s %s: %s", request.method, request.url.path, exc
    )
    if request.url.path.startswith("/v1/"):
        response = ErrorResponse(
            error=ErrorInfo(
                code="INTERNAL_ERROR",
                message=str(exc) or "Internal server error",
                details=None,
            )
        )
        return JSONResponse(
            status_code=500,
            content=response.model_dump(mode="json"),
        )
    if request.url.path.startswith("/api/subtitle-tasks"):
        return JSONResponse(
            status_code=500,
            content={"code": "INTERNAL_ERROR", "detail": "服务内部错误，请稍后重试。"},
        )
    return JSONResponse(
        status_code=500,
        content={"code": "INTERNAL_ERROR", "detail": str(exc) or "Internal server error"},
    )
 
 
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
