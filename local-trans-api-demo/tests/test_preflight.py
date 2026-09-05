from __future__ import annotations

import sys
import types
from dataclasses import replace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.config import FasterWhisperSettings, load_config
from app.core.preflight import (
    TARGET_DLLS,
    detect_cuda,
    detect_gpu,
    detect_runtime_dlls,
    run_preflight,
)
from app.main import create_app


def test_detect_gpu_success(monkeypatch) -> None:
    fake_nvml = types.ModuleType("pynvml")
    fake_nvml.nvmlInit = MagicMock()
    fake_nvml.nvmlDeviceGetCount = MagicMock(return_value=1)
    fake_nvml.nvmlDeviceGetHandleByIndex = MagicMock(return_value="handle_0")
    fake_nvml.nvmlDeviceGetName = MagicMock(return_value="NVIDIA GeForce RTX 4090")
    fake_nvml.nvmlSystemGetDriverVersion = MagicMock(return_value="552.22")
    fake_nvml.nvmlSystemGetCudaDriverVersion = MagicMock(return_value=12040)
    fake_nvml.nvmlDeviceGetMemoryInfo = MagicMock(
        return_value=types.SimpleNamespace(
            total=25769803776, free=22000000000, used=3769803776
        )
    )
    fake_nvml.nvmlShutdown = MagicMock()

    monkeypatch.setitem(sys.modules, "pynvml", fake_nvml)

    info = detect_gpu()
    assert info["available"] is True
    assert info["count"] == 1
    assert info["driver_version"] == "552.22"
    assert info["cuda_driver_version"] == "12.4"
    assert len(info["devices"]) == 1
    assert info["devices"][0]["name"] == "NVIDIA GeForce RTX 4090"
    assert info["devices"][0]["total_memory_bytes"] == 25769803776
    assert info["problems"] == []
    fake_nvml.nvmlShutdown.assert_called_once()


def test_detect_gpu_nvml_init_fails(monkeypatch) -> None:
    fake_nvml = types.ModuleType("pynvml")
    fake_nvml.nvmlInit = MagicMock(side_effect=RuntimeError("Driver library not found"))
    monkeypatch.setitem(sys.modules, "pynvml", fake_nvml)

    info = detect_gpu()
    assert info["available"] is False
    assert info["count"] == 0
    assert "Driver library not found" in (info["error"] or "")
    assert len(info["problems"]) == 1
    assert "driver is unavailable" in info["problems"][0].lower()
    assert any("nvidia.com" in h for h in info["hints"])


def test_detect_gpu_zero_devices(monkeypatch) -> None:
    fake_nvml = types.ModuleType("pynvml")
    fake_nvml.nvmlInit = MagicMock()
    fake_nvml.nvmlDeviceGetCount = MagicMock(return_value=0)
    fake_nvml.nvmlSystemGetDriverVersion = MagicMock(return_value="552.22")
    fake_nvml.nvmlSystemGetCudaDriverVersion = MagicMock(return_value=12040)
    fake_nvml.nvmlShutdown = MagicMock()
    monkeypatch.setitem(sys.modules, "pynvml", fake_nvml)

    info = detect_gpu()
    assert info["available"] is False
    assert info["count"] == 0
    assert any("No NVIDIA GPU detected" in p for p in info["problems"])


def test_detect_cuda_success(monkeypatch) -> None:
    fake_ct2 = types.SimpleNamespace(get_cuda_device_count=lambda: 1)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ct2)

    info = detect_cuda()
    assert info["available"] is True
    assert info["device_count"] == 1
    assert info["problems"] == []


def test_detect_cuda_zero_count(monkeypatch) -> None:
    fake_ct2 = types.SimpleNamespace(get_cuda_device_count=lambda: 0)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ct2)

    info = detect_cuda()
    assert info["available"] is False
    assert info["device_count"] == 0
    assert any("0 CUDA devices" in p for p in info["problems"])


def test_detect_cuda_not_installed(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "ctranslate2", None)

    info = detect_cuda()
    assert info["available"] is False
    assert any("ctranslate2 is not installed" in p for p in info["problems"])


def test_detect_runtime_dlls_windows_all_found(monkeypatch) -> None:
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(
        "app.core.preflight._find_dll_on_windows",
        lambda name: f"C:\\CUDA\\bin\\{name}",
    )

    result = detect_runtime_dlls()
    assert result["status"] == "checked"
    assert result["all_found"] is True
    assert result["problems"] == []
    for dll in TARGET_DLLS:
        assert result["dlls"][dll]["found"] is True
        assert result["dlls"][dll]["path"] == f"C:\\CUDA\\bin\\{dll}"


def test_detect_runtime_dlls_windows_missing(monkeypatch) -> None:
    monkeypatch.setattr(sys, "platform", "win32")

    def mock_find(name: str):
        if name == "cudnn64_9.dll":
            return None
        return f"C:\\CUDA\\bin\\{name}"

    monkeypatch.setattr("app.core.preflight._find_dll_on_windows", mock_find)

    result = detect_runtime_dlls()
    assert result["status"] == "checked"
    assert result["all_found"] is False
    assert result["dlls"]["cudnn64_9.dll"]["found"] is False
    assert any("cudnn64_9.dll" in p for p in result["problems"])
    assert any("cudnn" in h.lower() for h in result["hints"])


def test_detect_runtime_dlls_non_windows_skipped(monkeypatch) -> None:
    monkeypatch.setattr(sys, "platform", "darwin")

    result = detect_runtime_dlls()
    assert result["status"] == "skipped"
    assert result["all_found"] is True
    assert result["problems"] == []


def test_run_preflight_aggregate(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.core.preflight.detect_gpu",
        lambda: {"available": True, "problems": [], "hints": []},
    )
    monkeypatch.setattr(
        "app.core.preflight.detect_cuda",
        lambda: {"available": True, "problems": [], "hints": []},
    )
    monkeypatch.setattr(
        "app.core.preflight.detect_runtime_dlls",
        lambda: {"status": "checked", "all_found": True, "problems": [], "hints": []},
    )

    report = run_preflight()
    assert report["ok"] is True
    assert report["problems"] == []


def test_run_preflight_aggregate_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.core.preflight.detect_gpu",
        lambda: {"available": False, "problems": ["No GPU found"], "hints": ["Buy GPU"]},
    )
    monkeypatch.setattr(
        "app.core.preflight.detect_cuda",
        lambda: {"available": True, "problems": [], "hints": []},
    )
    monkeypatch.setattr(
        "app.core.preflight.detect_runtime_dlls",
        lambda: {"status": "skipped", "all_found": True, "problems": [], "hints": []},
    )

    report = run_preflight()
    assert report["ok"] is False
    assert "No GPU found" in report["problems"]
    assert "Buy GPU" in report["hints"]


def test_api_setup_preflight_endpoint() -> None:
    settings = Settings(
        host="127.0.0.1",
        port=8765,
        log_level="INFO",
        mock_transcription_delay=0.0,
        mock_transcription_fail=False,
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    response = client.get("/api/setup/preflight")
    assert response.status_code == 200
    data = response.json()
    assert "ok" in data
    assert "platform" in data
    assert "gpu" in data
    assert "cuda" in data
    assert "dlls" in data
    assert "problems" in data
    assert "hints" in data


def test_startup_gate_fails_fast_on_real_engine(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.run_preflight",
        lambda: {
            "ok": False,
            "problems": ["Missing required runtime DLL: cudnn64_9.dll"],
            "hints": ["Install cuDNN 9"],
        },
    )

    config = replace(
        load_config(),
        engine="faster-whisper",
        faster_whisper=FasterWhisperSettings(device="cuda", compute_type="float16"),
    )

    with pytest.raises(RuntimeError, match="GPU Preflight failed.*cudnn64_9.dll"):
        create_app(config=config)


def test_startup_gate_passes_on_real_engine_when_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.run_preflight",
        lambda: {
            "ok": True,
            "problems": [],
            "hints": [],
        },
    )
    fake_ct2 = types.SimpleNamespace(get_cuda_device_count=lambda: 1)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ct2)

    config = replace(
        load_config(),
        engine="faster-whisper",
        faster_whisper=FasterWhisperSettings(device="cuda", compute_type="float16"),
    )

    app = create_app(config=config)
    assert app.state.config.engine == "faster-whisper"


def test_startup_gate_skipped_on_mock_engine(monkeypatch) -> None:
    # Even if preflight would fail, mock engine does not run preflight check
    monkeypatch.setattr(
        "app.main.run_preflight",
        lambda: {
            "ok": False,
            "problems": ["No GPU found"],
            "hints": [],
        },
    )

    config = replace(load_config(), engine="mock")
    app = create_app(config=config)
    assert app.state.config.engine == "mock"
