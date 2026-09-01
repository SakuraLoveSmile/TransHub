from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.core.errors import (
    DownloadBusyError,
    EngineBusyError,
    InferenceError,
    InvalidPathError,
    ModelLoadError,
    ModelNotInstalledError,
    OutputNotFoundError,
    UnknownModelError,
    UnknownProfileError,
    UnsupportedFileError,
)
from app.engines import mock_engine
from app.engines.base import build_result as base_build_result
from app.engines.faster_whisper_engine import build_result as faster_build_result
from app.main import create_app


def make_client() -> TestClient:
    return TestClient(create_app(Settings()))


def test_app_error_codes_are_stable() -> None:
    expected = {
        UnknownProfileError: (404, "UNKNOWN_PROFILE"),
        UnknownModelError: (404, "UNKNOWN_MODEL"),
        ModelNotInstalledError: (404, "MODEL_NOT_INSTALLED"),
        EngineBusyError: (409, "ENGINE_BUSY"),
        DownloadBusyError: (409, "DOWNLOAD_BUSY"),
        InvalidPathError: (422, "INVALID_PATH"),
        UnsupportedFileError: (400, "UNSUPPORTED_FILE"),
        OutputNotFoundError: (404, "OUTPUT_NOT_FOUND"),
        ModelLoadError: (503, "MODEL_LOAD_FAILED"),
        InferenceError: (500, "INFERENCE_FAILED"),
    }

    for error_type, (status_code, code) in expected.items():
        error = error_type("test detail")
        assert error.status_code == status_code
        assert error.code == code
        assert error.detail == "test detail"


def test_stable_model_and_status_contract() -> None:
    with make_client() as client:
        status_response = client.get("/api/status")
        models_response = client.get("/api/models")

    assert status_response.status_code == 200
    assert set(status_response.json()) == {
        "status",
        "engine",
        "mock",
        "loaded_model",
        "device",
    }
    assert status_response.json()["status"] in {"idle", "running"}
    assert models_response.status_code == 200
    models = models_response.json()["models"]
    assert isinstance(models, list)
    assert models
    assert all(
        {"id", "name", "type", "installed", "loaded", "mock"} <= set(model)
        for model in models
    )


def test_stable_endpoint_names_are_frozen() -> None:
    with make_client() as client:
        document = client.get("/openapi.json").json()

    assert {
        "/health",
        "/api/status",
        "/api/models",
        "/api/models/load",
        "/api/models/unload",
        "/api/transcribe",
        "/api/translate-audio",
        "/api/output/{name}",
    } <= set(document["paths"])
    assert "/api/translate" not in document["paths"]


def test_engines_use_the_shared_result_builder() -> None:
    assert base_build_result is mock_engine.build_result
    assert base_build_result is faster_build_result


def test_stable_inference_result_shape_is_shared(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.01)
    with make_client() as client:
        transcribe = client.post("/api/transcribe", json={"path": "demo.flac"})
        translate = client.post(
            "/api/translate-audio", json={"path": "demo.flac"}
        )

    common = {
        "success",
        "mock",
        "profile",
        "model",
        "duration",
        "processing_time",
        "realtime_factor",
        "speed",
        "text",
        "segments",
    }
    assert transcribe.status_code == 200
    assert translate.status_code == 200
    transcribe_body = transcribe.json()
    translate_body = translate.json()
    assert set(transcribe_body) == common | {"language"}
    assert set(translate_body) == common | {"source_language", "target_language"}
    assert set(transcribe_body) - {"language"} == set(translate_body) - {
        "source_language",
        "target_language",
    }
    for body in (transcribe_body, translate_body):
        assert isinstance(body["segments"], list)
        assert all(
            {"start", "end", "text"} <= set(segment)
            and isinstance(segment["start"], (int, float))
            and isinstance(segment["end"], (int, float))
            and isinstance(segment["text"], str)
            for segment in body["segments"]
        )
        assert not {
            "gpu_name",
            "cuda_version",
            "compute_type",
            "model_path",
            "engine_debug",
            "memory_usage",
        }.intersection(body)


def test_stable_error_responses_use_code_and_detail(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "LOAD_DELAY", 0.01)
    with make_client() as client:
        unknown_model = client.post(
            "/api/models/load", json={"model": "not-a-real-model"}
        )
        missing_output = client.get("/api/output/not-exists.json")
        invalid_output = client.get("/api/output/config.toml")

    assert unknown_model.status_code == 404
    assert unknown_model.json()["code"] == "UNKNOWN_MODEL"
    assert isinstance(unknown_model.json()["detail"], str)
    assert missing_output.status_code == 404
    assert missing_output.json()["code"] == "OUTPUT_NOT_FOUND"
    assert invalid_output.status_code == 422
    assert invalid_output.json()["code"] == "INVALID_PATH"


def test_output_path_cannot_escape_output_directory() -> None:
    with make_client() as client:
        response = client.get("/api/output/../config.toml")

    assert response.status_code in {404, 422}
