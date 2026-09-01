from __future__ import annotations

import sys
import types

import pytest

from app.core.config import load_config
from app.engines.faster_whisper_engine import select_device


def test_auto_device_selects_cuda_when_gpu_is_available(monkeypatch) -> None:
    fake_ctranslate2 = types.SimpleNamespace(get_cuda_device_count=lambda: 1)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ctranslate2)

    assert select_device("auto", "default") == ("cuda", "float16")


def test_auto_device_fails_when_cuda_gpu_is_unavailable(monkeypatch) -> None:
    fake_ctranslate2 = types.SimpleNamespace(get_cuda_device_count=lambda: 0)
    monkeypatch.setitem(sys.modules, "ctranslate2", fake_ctranslate2)

    with pytest.raises(RuntimeError, match="NVIDIA CUDA GPU is required"):
        select_device("auto", "default")


def test_explicit_non_cuda_device_is_rejected() -> None:
    with pytest.raises(RuntimeError, match="only 'cuda' is supported"):
        select_device("cpu", "int8")


def test_config_rejects_cpu_device(tmp_path) -> None:
    config = tmp_path / "config.toml"
    config.write_text('[faster_whisper]\ndevice = "cpu"\n', encoding="utf-8")

    with pytest.raises(RuntimeError, match="Unknown \\[faster_whisper\\] device"):
        load_config(config)
