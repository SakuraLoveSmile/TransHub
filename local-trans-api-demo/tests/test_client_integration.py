"""Tests for client integration and lifecycle verification (Item 4).

Validates that TransHub's Stable API v1 completely and smoothly supports
real client consumption patterns in mock/Mac development environments.
"""

from __future__ import annotations

import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.config import Settings
from app.engines import mock_engine
from app.main import create_app
from scripts.client_integration_check import (
    SRT_BLOCK_RE,
    build_local_srt,
    format_srt_timestamp,
)

SAMPLE_FILE = Path(__file__).resolve().parents[1] / "samples" / "1.flac"


def make_client() -> TestClient:
    return TestClient(create_app(Settings()))


def test_client_readiness_four_steps() -> None:
    with make_client() as client:
        # Step 1: Health
        health_resp = client.get("/health")
        assert health_resp.status_code == 200
        health = health_resp.json()
        assert health.get("status") == "ok"
        assert health.get("service") == "transferhub"
        assert health.get("version")

        # Step 2: Preflight
        preflight_resp = client.get("/api/setup/preflight")
        assert preflight_resp.status_code == 200
        preflight = preflight_resp.json()
        assert "ok" in preflight
        assert "problems" in preflight
        assert "hints" in preflight

        # Step 3: Status
        status_resp = client.get("/api/status")
        assert status_resp.status_code == 200
        state = status_resp.json()
        assert state["status"] in {"idle", "running"}
        assert "engine" in state
        assert "device" in state

        # Step 4: Models
        models_resp = client.get("/api/models")
        assert models_resp.status_code == 200
        models_list = models_resp.json().get("models", [])
        models_map = {m["id"]: m for m in models_list}
        assert "whisper-ja-1.5b" in models_map
        assert "chickenrice-v2" in models_map


def test_client_warmup_model(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "LOAD_DELAY", 0.01)
    with make_client() as client:
        resp = client.post("/api/models/load", json={"model": "whisper-ja-1.5b"})
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert resp.json()["loaded_model"] == "whisper-ja-1.5b"


def test_client_upload_and_transcribe_pipeline(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.01)
    with make_client() as client:
        # 1. Upload
        upload_resp = client.post(
            "/api/upload",
            files={"file": ("test_client.flac", SAMPLE_FILE.read_bytes(), "audio/flac")},
        )
        assert upload_resp.status_code == 200
        upload_data = upload_resp.json()
        assert "path" in upload_data
        assert "name" in upload_data

        # 2. Transcribe
        transcribe_resp = client.post(
            "/api/transcribe", json={"path": upload_data["path"]}
        )
        assert transcribe_resp.status_code == 200
        result = transcribe_resp.json()
        assert result["success"] is True
        assert result["language"] == "ja"
        assert result["duration"] > 0
        assert result["processing_time"] > 0
        assert isinstance(result["segments"], list)
        assert len(result["segments"]) > 0
        for seg in result["segments"]:
            assert seg["start"] >= 0
            assert seg["end"] > seg["start"]
            assert isinstance(seg["text"], str)


def test_client_upload_and_translate_pipeline(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.01)
    with make_client() as client:
        upload_resp = client.post(
            "/api/upload",
            files={"file": ("test_client_tr.flac", SAMPLE_FILE.read_bytes(), "audio/flac")},
        )
        assert upload_resp.status_code == 200
        server_path = upload_resp.json()["path"]

        translate_resp = client.post(
            "/api/translate-audio", json={"path": server_path}
        )
        assert translate_resp.status_code == 200
        result = translate_resp.json()
        assert result["success"] is True
        assert result["source_language"] == "ja"
        assert result["target_language"] == "zh-CN"
        assert len(result["segments"]) > 0


def test_client_srt_reconstruction_matches_server_output(monkeypatch) -> None:
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.01)
    with make_client() as client:
        upload_resp = client.post(
            "/api/upload",
            files={"file": ("reconstruct.flac", SAMPLE_FILE.read_bytes(), "audio/flac")},
        )
        upload_data = upload_resp.json()
        stem = Path(upload_data["name"]).stem

        transcribe_resp = client.post(
            "/api/transcribe", json={"path": upload_data["path"]}
        )
        result = transcribe_resp.json()
        segments = result["segments"]

        # Local reconstruction
        local_srt = build_local_srt(segments)
        local_blocks = SRT_BLOCK_RE.findall(local_srt)
        assert len(local_blocks) == len(segments)

        # Server-side output fetch
        server_srt_resp = client.get(f"/api/output/{stem}.transcribe.srt")
        assert server_srt_resp.status_code == 200
        server_srt = server_srt_resp.text
        server_blocks = SRT_BLOCK_RE.findall(server_srt)

        assert len(server_blocks) == len(local_blocks)
        for local_b, server_b in zip(local_blocks, server_blocks):
            assert local_b[0] == server_b[0]  # index
            assert local_b[1] == server_b[1]  # start
            assert local_b[2] == server_b[2]  # end
            assert local_b[3].strip() == server_b[3].strip()  # text

        # Also verify JSON output consistency
        server_json_resp = client.get(f"/api/output/{stem}.transcribe.json")
        assert server_json_resp.status_code == 200
        stored_json = server_json_resp.json()
        assert stored_json["text"] == result["text"]
        assert len(stored_json["segments"]) == len(segments)


def test_client_409_concurrency_and_exponential_backoff(monkeypatch) -> None:
    # Set longer delay so the first request holds the engine lock
    monkeypatch.setattr(mock_engine, "INFER_DELAY", 0.35)

    client = make_client()
    first_resp_holder = {}

    def slow_request():
        first_resp_holder["resp"] = client.post(
            "/api/transcribe", json={"path": "slow.flac"}
        )

    t = threading.Thread(target=slow_request)
    t.start()

    # Wait for status to transition to running
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        st = client.get("/api/status").json()
        if st.get("status") == "running":
            break
        time.sleep(0.02)

    # Concurrently execute second request with retry loop
    got_409 = False
    retries = 0
    final_resp = None
    for attempt in range(10):
        resp = client.post("/api/transcribe", json={"path": "retry.flac"})
        if resp.status_code == 409:
            got_409 = True
            retries += 1
            time.sleep(0.08 * (1.5**attempt))
            continue
        final_resp = resp
        break

    t.join()

    assert got_409 is True
    assert retries >= 1
    assert final_resp is not None
    assert final_resp.status_code == 200
    assert final_resp.json()["success"] is True
    assert first_resp_holder["resp"].status_code == 200


def test_client_error_contracts() -> None:
    with make_client() as client:
        # Unsupported file suffix
        unsupported = client.post(
            "/api/upload",
            files={"file": ("script.py", b"print(1)", "text/plain")},
        )
        assert unsupported.status_code == 400
        assert unsupported.json()["code"] == "UNSUPPORTED_FILE"

        # Invalid path: output filename format validation returns 422 INVALID_PATH
        invalid_path = client.get("/api/output/invalid_name.txt")
        assert invalid_path.status_code == 422
        assert invalid_path.json()["code"] == "INVALID_PATH"

        # Real engine media existence validation: FasterWhisperEngine raises InvalidPathError
        from app.core.errors import InvalidPathError
        from app.engines.faster_whisper_engine import FasterWhisperEngine
        engine = FasterWhisperEngine.__new__(FasterWhisperEngine)
        with pytest.raises(InvalidPathError):
            engine._validated_media("non_existent_audio.flac")

        # Unknown model
        unknown_model = client.post(
            "/api/models/load", json={"model": "non_existent_model"}
        )
        assert unknown_model.status_code == 404
        assert unknown_model.json()["code"] == "UNKNOWN_MODEL"

        # Output not found
        missing_out = client.get("/api/output/missing.srt")
        assert missing_out.status_code == 404
        assert missing_out.json()["code"] == "OUTPUT_NOT_FOUND"

        # Output directory escape
        escape_out = client.get("/api/output/../config.toml")
        assert escape_out.status_code in {404, 422}


@pytest.fixture(scope="module")
def live_test_server():
    """Start a live uvicorn server in a daemon thread on a random free port."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    config = uvicorn.Config(
        create_app(Settings()), host="127.0.0.1", port=port, log_level="warning"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Wait for server readiness
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.05)
    else:
        pytest.fail("Live test server failed to start within 5s")

    yield url


def test_client_integration_checker_script_e2e(live_test_server: str) -> None:
    """Run scripts/client_integration_check.py against live test server in mock mode."""
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "client_integration_check.py"
    cmd = [
        sys.executable,
        str(script_path),
        "--base-url",
        live_test_server,
        "--file",
        str(SAMPLE_FILE),
        "--allow-mock",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    print("STDOUT:\n", proc.stdout)
    print("STDERR:\n", proc.stderr)
    assert proc.returncode == 0
    assert "ALL CHECKS PASSED (0 failed)" in proc.stdout
