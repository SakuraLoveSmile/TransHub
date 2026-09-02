from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core import runtime_preflight
from app.core.config import REQUIRED_MODEL_FILES
from app.core.errors import ModelLoadError
from app.engines.faster_whisper_engine import FasterWhisperEngine
from app.main import create_app


@pytest.fixture(autouse=True)
def clear_runtime_registration_cache():
    registered = runtime_preflight._REGISTERED_DIRECTORIES.copy()
    handles = runtime_preflight._DLL_DIRECTORY_HANDLES.copy()
    runtime_preflight._REGISTERED_DIRECTORIES.clear()
    runtime_preflight._DLL_DIRECTORY_HANDLES.clear()
    yield
    runtime_preflight._REGISTERED_DIRECTORIES.clear()
    runtime_preflight._REGISTERED_DIRECTORIES.update(registered)
    runtime_preflight._DLL_DIRECTORY_HANDLES.clear()
    runtime_preflight._DLL_DIRECTORY_HANDLES.update(handles)


def use_fake_windows(monkeypatch) -> None:
    monkeypatch.setattr(runtime_preflight, "_is_windows", lambda: True)
    monkeypatch.setattr(runtime_preflight.sys, "platform", "win32")


def make_cuda_bin(tmp_path: Path, names: tuple[str, ...]) -> Path:
    directory = tmp_path / "cuda" / "bin"
    directory.mkdir(parents=True)
    for name in names:
        (directory / name).touch()
    return directory


def configure_cuda_path(monkeypatch, directory: Path) -> None:
    monkeypatch.setenv("CUDA_PATH", str(directory.parent))
    monkeypatch.setenv("PATH", str(directory))


def patch_registration_and_loading(monkeypatch):
    registered = []
    loaded = []
    monkeypatch.setattr(
        runtime_preflight,
        "_add_dll_directory",
        lambda directory: registered.append(str(directory)) or object(),
    )
    monkeypatch.setattr(
        runtime_preflight,
        "_load_dll",
        lambda name: loaded.append(name) or object(),
    )
    return registered, loaded


def test_non_windows_is_safe_and_does_not_touch_dlls(monkeypatch) -> None:
    monkeypatch.setattr(runtime_preflight, "_is_windows", lambda: False)
    monkeypatch.setattr(
        runtime_preflight,
        "_add_dll_directory",
        lambda _: pytest.fail("DLL directory registration must not run"),
    )
    monkeypatch.setattr(
        runtime_preflight,
        "_load_dll",
        lambda _: pytest.fail("DLL loading must not run"),
    )

    report = runtime_preflight.probe_runtime()

    assert report.code == runtime_preflight.NOT_WINDOWS
    assert not report.ok
    assert report.registered_directories == []
    assert all(not dll.found and not dll.loaded for dll in report.dlls)


def test_runtime_ok_registers_and_loads_all_required_dlls(monkeypatch, tmp_path) -> None:
    use_fake_windows(monkeypatch)
    directory = make_cuda_bin(tmp_path, runtime_preflight.REQUIRED_DLLS)
    configure_cuda_path(monkeypatch, directory)
    registered, loaded = patch_registration_and_loading(monkeypatch)
    monkeypatch.setattr(runtime_preflight, "_cuda_device_count", lambda: 1)

    report = runtime_preflight.probe_runtime()

    assert report.code == runtime_preflight.RUNTIME_OK
    assert report.ok
    assert report.cuda_devices == 1
    assert report.registered_directories == [str(directory)]
    assert registered == [str(directory)]
    assert loaded == list(runtime_preflight.REQUIRED_DLLS)
    assert all(dll.found and dll.loaded for dll in report.dlls)
    assert report.as_dict()["dlls"][0]["name"] == "cublas64_12.dll"


def test_register_dll_directories_is_idempotent(monkeypatch, tmp_path) -> None:
    use_fake_windows(monkeypatch)
    directory = make_cuda_bin(tmp_path, ())
    configure_cuda_path(monkeypatch, directory)
    registered, _ = patch_registration_and_loading(monkeypatch)

    first = runtime_preflight.register_dll_directories()
    second = runtime_preflight.register_dll_directories()

    assert first == second == [str(directory)]
    assert registered == [str(directory)]


def test_no_gpu_and_unavailable_ctranslate2_have_distinct_codes(monkeypatch, tmp_path) -> None:
    use_fake_windows(monkeypatch)
    directory = make_cuda_bin(tmp_path, runtime_preflight.REQUIRED_DLLS)
    configure_cuda_path(monkeypatch, directory)
    monkeypatch.setattr(runtime_preflight, "_add_dll_directory", lambda _: object())
    monkeypatch.setattr(runtime_preflight, "_load_dll", lambda _: object())

    monkeypatch.setattr(runtime_preflight, "_cuda_device_count", lambda: 0)
    assert runtime_preflight.probe_runtime().code == runtime_preflight.NO_NVIDIA_GPU

    monkeypatch.setattr(runtime_preflight, "_cuda_device_count", lambda: None)
    assert (
        runtime_preflight.probe_runtime().code
        == runtime_preflight.CUDA_DEVICE_UNAVAILABLE
    )


def test_cuda_device_unavailable_when_ctranslate2_import_fails(monkeypatch) -> None:
    monkeypatch.setitem(sys.modules, "ctranslate2", None)

    assert runtime_preflight._cuda_device_count() is None


def test_missing_candidate_directory_is_classified_as_toolkit_missing(monkeypatch, tmp_path) -> None:
    use_fake_windows(monkeypatch)
    monkeypatch.setenv("CUDA_PATH", str(tmp_path / "not-installed"))
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    monkeypatch.setattr(runtime_preflight.sys, "prefix", str(tmp_path / "python"))
    monkeypatch.setattr(runtime_preflight, "_cuda_device_count", lambda: 1)

    report = runtime_preflight.probe_runtime()

    assert report.code == runtime_preflight.CUDA_TOOLKIT_NOT_FOUND
    assert "CUDA_PATH" in report.message


@pytest.mark.parametrize(
    ("missing", "expected"),
    [
        ("cublas64_12.dll", runtime_preflight.CUBLAS_DLL_NOT_FOUND),
        ("cudnn64_9.dll", runtime_preflight.CUDNN_DLL_NOT_FOUND),
    ],
)
def test_missing_dlls_are_classified_by_library_family(
    monkeypatch, tmp_path, missing, expected
) -> None:
    use_fake_windows(monkeypatch)
    names = tuple(name for name in runtime_preflight.REQUIRED_DLLS if name != missing)
    directory = make_cuda_bin(tmp_path, names)
    configure_cuda_path(monkeypatch, directory)
    monkeypatch.setattr(runtime_preflight, "_cuda_device_count", lambda: 1)
    monkeypatch.setattr(runtime_preflight, "_add_dll_directory", lambda _: object())
    monkeypatch.setattr(runtime_preflight, "_load_dll", lambda _: object())

    report = runtime_preflight.probe_runtime()

    assert report.code == expected
    missing_probe = next(dll for dll in report.dlls if dll.name == missing)
    assert not missing_probe.found
    assert not missing_probe.loaded


def test_present_dll_that_fails_to_load_has_explicit_code(monkeypatch, tmp_path) -> None:
    use_fake_windows(monkeypatch)
    directory = make_cuda_bin(tmp_path, runtime_preflight.REQUIRED_DLLS)
    configure_cuda_path(monkeypatch, directory)
    monkeypatch.setattr(runtime_preflight, "_cuda_device_count", lambda: 1)
    monkeypatch.setattr(runtime_preflight, "_add_dll_directory", lambda _: object())

    def fail_cudnn(name: str):
        if name == "cudnn64_9.dll":
            raise OSError("wrong architecture")
        return object()

    monkeypatch.setattr(runtime_preflight, "_load_dll", fail_cudnn)

    report = runtime_preflight.probe_runtime()

    assert report.code == runtime_preflight.DLL_LOAD_FAILED
    cudnn = next(dll for dll in report.dlls if dll.name == "cudnn64_9.dll")
    assert cudnn.found and not cudnn.loaded
    assert "wrong architecture" in (cudnn.error or "")


def test_cuda_load_is_blocked_before_whisper_model_when_preflight_fails(
    monkeypatch, tmp_path
) -> None:
    model_directory = tmp_path / "models" / "whisper-ja-1.5b"
    model_directory.mkdir(parents=True)
    for name in REQUIRED_MODEL_FILES:
        (model_directory / name).touch()

    engine = FasterWhisperEngine.__new__(FasterWhisperEngine)
    engine.config = SimpleNamespace(models_directory=tmp_path / "models")
    engine.device = "cuda"
    engine.compute_type = "float16"
    engine.model = None
    engine.loaded_model = None
    fake_faster_whisper = types.ModuleType("faster_whisper")
    fake_faster_whisper.WhisperModel = lambda *args, **kwargs: pytest.fail(
        "WhisperModel must not be called when preflight fails"
    )
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_faster_whisper)
    monkeypatch.setattr(
        runtime_preflight,
        "probe_runtime",
        lambda: runtime_preflight.RuntimePreflightReport(
            code=runtime_preflight.CUDNN_DLL_NOT_FOUND,
            ok=False,
            platform="win32",
            cuda_devices=1,
            registered_directories=[],
            candidate_directories=[],
            dlls=[],
            message="CUDNN_DLL_NOT_FOUND: install cuDNN 9 for CUDA 12",
        ),
    )

    with pytest.raises(ModelLoadError, match="CUDNN_DLL_NOT_FOUND"):
        asyncio.run(engine.load_model("whisper-ja-1.5b"))


def test_setup_env_exposes_preflight_without_changing_stable_status(monkeypatch) -> None:
    report = runtime_preflight.RuntimePreflightReport(
        code=runtime_preflight.NOT_WINDOWS,
        ok=False,
        platform="darwin",
        cuda_devices=0,
        registered_directories=[],
        candidate_directories=[],
        dlls=[],
        message="NOT_WINDOWS: diagnostics only",
    )
    monkeypatch.setattr(runtime_preflight, "probe_runtime", lambda: report)
    monkeypatch.setattr(runtime_preflight, "register_dll_directories", list)

    with TestClient(create_app(Settings())) as client:
        env_response = client.get("/api/setup/env")
        status_response = client.get("/api/status")

    assert env_response.status_code == 200
    assert env_response.json()["runtime_preflight"]["code"] == runtime_preflight.NOT_WINDOWS
    assert set(status_response.json()) == {
        "status",
        "engine",
        "mock",
        "loaded_model",
        "device",
    }


def test_startup_continues_when_dll_registration_raises(monkeypatch) -> None:
    def fail_registration():
        raise OSError("test registration failure")

    monkeypatch.setattr(runtime_preflight, "register_dll_directories", fail_registration)

    application = create_app(Settings())

    assert application.state.gpu_dll_directories == []
