"""Tests for service runtime stability reinforcement (item 3)."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import types
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.config import FasterWhisperSettings, load_config
from app.engines import mock_engine
from app.main import create_app


def make_client() -> TestClient:
    return TestClient(create_app(Settings()))


def test_concurrent_load_and_unload_during_infer_rejected_409(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.4)
    monkeypatch.setattr(mock_engine, "LOAD_DELAY", 0.05)
    monkeypatch.setattr(mock_engine, "UNLOAD_DELAY", 0.05)

    client = make_client()
    transcribe_result = {}

    def run_transcribe():
        resp = client.post("/api/transcribe", json={"path": "test.flac"})
        transcribe_result["status"] = resp.status_code
        transcribe_result["body"] = resp.json()

    thread = threading.Thread(target=run_transcribe)
    thread.start()

    # Wait until inference starts and status is running
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        status_resp = client.get("/api/status")
        if status_resp.status_code == 200 and status_resp.json().get("status") == "running":
            break
        time.sleep(0.02)

    # Attempting to load or unload a model during active inference must yield 409 ENGINE_BUSY
    load_resp = client.post("/api/models/load", json={"model": "chickenrice-v2"})
    unload_resp = client.post("/api/models/unload")

    thread.join()

    assert load_resp.status_code == 409
    assert load_resp.json() == {
        "code": "ENGINE_BUSY",
        "detail": "Inference engine is busy",
    }
    assert unload_resp.status_code == 409
    assert unload_resp.json() == {
        "code": "ENGINE_BUSY",
        "detail": "Inference engine is busy",
    }

    assert transcribe_result.get("status") == 200
    assert transcribe_result.get("body", {}).get("success") is True


def test_status_running_and_busy_during_model_load(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "LOAD_DELAY", 0.4)

    app = create_app(Settings())
    client = TestClient(app)
    load_result = {}

    def run_load():
        resp = client.post("/api/models/load", json={"model": "chickenrice-v2"})
        load_result["status"] = resp.status_code
        load_result["body"] = resp.json()

    thread = threading.Thread(target=run_load)
    thread.start()

    # Wait until status transitions to running
    running_detected = False
    busy_flag_detected = False
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        status_resp = client.get("/api/status")
        if status_resp.status_code == 200 and status_resp.json().get("status") == "running":
            running_detected = True
            busy_flag_detected = app.state.engine.busy
            break
        time.sleep(0.02)

    # While loading, concurrent transcribe and unload calls must receive 409
    busy_infer = client.post("/api/transcribe", json={"path": "test.flac"})
    busy_unload = client.post("/api/models/unload")

    thread.join()

    assert running_detected is True
    assert busy_flag_detected is True
    assert busy_infer.status_code == 409
    assert busy_infer.json()["code"] == "ENGINE_BUSY"
    assert busy_unload.status_code == 409
    assert busy_unload.json()["code"] == "ENGINE_BUSY"

    assert load_result.get("status") == 200
    assert load_result.get("body", {}).get("loaded_model") == "chickenrice-v2"


def test_lifespan_shutdown_cancels_download_and_unloads_model(caplog) -> None:
    app = create_app(Settings())
    mock_setup_shutdown = AsyncMock()
    mock_engine_unload = AsyncMock()
    app.state.setup.shutdown = mock_setup_shutdown
    app.state.engine.unload_model = mock_engine_unload

    with caplog.at_level(logging.INFO):
        with TestClient(app):
            pass

    mock_setup_shutdown.assert_awaited_once()
    mock_engine_unload.assert_awaited_once()
    assert "TransferHub stopped: shutdown complete" in caplog.text


@pytest.mark.anyio
async def test_setup_service_shutdown_cancels_active_task() -> None:
    from app.core.config import load_config
    from app.services.setup_service import SetupService

    setup = SetupService(load_config())

    async def slow_download():
        await asyncio.sleep(60.0)

    task = asyncio.create_task(slow_download())
    setup._task = task

    await setup.shutdown()

    assert task.done()
    assert task.cancelled()
    assert setup._task is None


def test_unhandled_exception_api_returns_stable_internal_error(monkeypatch, caplog) -> None:
    app = create_app(Settings())

    def explode():
        raise RuntimeError("unexpected database explosion")

    monkeypatch.setattr(app.state.engine, "list_models", explode)

    with caplog.at_level(logging.ERROR):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/api/models")

    assert response.status_code == 500
    assert response.json() == {
        "code": "INTERNAL_ERROR",
        "detail": "unexpected database explosion",
    }
    assert "unexpected database explosion" in caplog.text


def test_unhandled_exception_v1_returns_error_response(monkeypatch, caplog) -> None:
    app = create_app(Settings())

    def explode(task_id):
        raise RuntimeError("task manager crashed")

    monkeypatch.setattr(app.state.task_store, "get", explode)

    with caplog.at_level(logging.ERROR):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/v1/tasks/task-123")

    assert response.status_code == 500
    body = response.json()
    assert "error" in body
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert "task manager crashed" in body["error"]["message"]
    assert "task manager crashed" in caplog.text



def test_preflight_ok_and_startup_logs(monkeypatch, caplog) -> None:
    fake_preflight = {
        "ok": True,
        "problems": [],
        "hints": [],
        "gpu": {
            "driver_version": "552.22",
            "cuda_driver_version": "12.4",
            "devices": [{"name": "NVIDIA GeForce RTX 4090"}],
        },
    }
    monkeypatch.setattr("app.main.run_preflight", lambda: fake_preflight)
    fake_ct2 = types.SimpleNamespace(get_cuda_device_count=lambda: 1)
    monkeypatch.setitem(__import__("sys").modules, "ctranslate2", fake_ct2)

    config = replace(
        load_config(),
        engine="faster-whisper",
        faster_whisper=FasterWhisperSettings(device="cuda", compute_type="float16"),
    )

    with caplog.at_level(logging.INFO):
        app = create_app(config=config)
        with TestClient(app):
            pass

    assert "GPU Preflight passed: GPU=NVIDIA GeForce RTX 4090 driver=552.22 CUDA=12.4" in caplog.text
    assert "TransferHub started" in caplog.text
    assert "engine=faster-whisper" in caplog.text
    assert "device=cuda" in caplog.text


def test_infer_tolerates_write_outputs_failure(monkeypatch, caplog) -> None:
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.01)

    def fail_write(*args, **kwargs):
        raise OSError("Disk is read-only")

    monkeypatch.setattr("app.services.inference_service.write_outputs", fail_write)

    with caplog.at_level(logging.WARNING):
        client = make_client()
        response = client.post("/api/transcribe", json={"path": "sample.flac"})

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert "Failed to write outputs" in caplog.text


def test_api_request_logging_middleware(caplog) -> None:
    with caplog.at_level(logging.INFO):
        client = make_client()
        client.get("/api/status")

    # /api/* must be logged by the middleware
    assert any("GET /api/status -> 200" in record.message for record in caplog.records)

    caplog.clear()
    with caplog.at_level(logging.INFO):
        client.get("/health")
        client.get("/docs")

    # /health and /docs should NOT be logged by the /api/* middleware
    assert not any("GET /health ->" in record.message for record in caplog.records)
    assert not any("GET /docs ->" in record.message for record in caplog.records)


def test_model_load_and_unload_timing_logs(monkeypatch, caplog) -> None:
    monkeypatch.setattr(mock_engine, "LOAD_DELAY", 0.02)
    monkeypatch.setattr(mock_engine, "UNLOAD_DELAY", 0.02)

    with caplog.at_level(logging.INFO):
        client = make_client()
        client.post("/api/models/load", json={"model": "chickenrice-v2"})
        client.post("/api/models/unload")

    assert any("Loaded model chickenrice-v2 in" in record.message for record in caplog.records)
    assert any("Unloaded model in" in record.message for record in caplog.records)
