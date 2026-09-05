"""GPU and CUDA runtime preflight diagnostics."""

from __future__ import annotations

import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger("app.preflight")

TARGET_DLLS: tuple[str, ...] = (
    "cublas64_12.dll",
    "cublasLt64_12.dll",
    "cudnn64_9.dll",
)


def _safe_str(val: Any) -> str:
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    return str(val)


def detect_gpu() -> dict[str, Any]:
    """Detect NVIDIA GPUs, driver version, and VRAM via nvidia-ml-py (NVML)."""
    result: dict[str, Any] = {
        "available": False,
        "count": 0,
        "driver_version": None,
        "cuda_driver_version": None,
        "devices": [],
        "error": None,
        "problems": [],
        "hints": [],
    }

    try:
        import pynvml
    except ImportError as exc:
        result["error"] = "nvidia-ml-py is not installed"
        result["problems"].append("nvidia-ml-py is not installed")
        result["hints"].append(
            "Install AI dependencies: .venv\\Scripts\\pip install -r requirements-ai.txt"
        )
        return result

    try:
        pynvml.nvmlInit()
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        result["error"] = err_msg
        result["problems"].append(
            f"NVIDIA driver is unavailable or NVML failed to initialize ({err_msg})"
        )
        result["hints"].append(
            "Install the latest NVIDIA graphics driver from https://www.nvidia.com/drivers"
        )
        return result

    try:
        driver_ver = _safe_str(pynvml.nvmlSystemGetDriverVersion())
        result["driver_version"] = driver_ver

        try:
            cuda_driver_ver_raw = pynvml.nvmlSystemGetCudaDriverVersion()
            major = cuda_driver_ver_raw // 1000
            minor = (cuda_driver_ver_raw % 1000) // 10
            result["cuda_driver_version"] = f"{major}.{minor}"
        except Exception:
            pass

        count = int(pynvml.nvmlDeviceGetCount())
        result["count"] = count

        if count == 0:
            result["problems"].append("No NVIDIA GPU detected by NVML")
            result["hints"].append(
                "Verify your NVIDIA GPU is connected and recognized in Windows Device Manager"
            )
            return result

        for i in range(count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            name = _safe_str(pynvml.nvmlDeviceGetName(handle))
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            result["devices"].append(
                {
                    "index": i,
                    "name": name,
                    "total_memory_bytes": int(mem.total),
                    "free_memory_bytes": int(mem.free),
                    "used_memory_bytes": int(mem.used),
                }
            )

        result["available"] = True
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        result["error"] = err_msg
        result["problems"].append(f"Failed querying NVIDIA GPU details: {err_msg}")
    finally:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass

    return result


def detect_cuda() -> dict[str, Any]:
    """Detect CUDA availability and device count via ctranslate2."""
    result: dict[str, Any] = {
        "available": False,
        "device_count": 0,
        "version": None,
        "error": None,
        "problems": [],
        "hints": [],
    }

    try:
        import ctranslate2
    except ImportError as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        result["error"] = err_msg
        result["problems"].append("ctranslate2 is not installed")
        result["hints"].append(
            "Install AI dependencies: .venv\\Scripts\\pip install -r requirements-ai.txt"
        )
        return result

    try:
        count = int(ctranslate2.get_cuda_device_count())
        result["device_count"] = count
        if count == 0:
            result["problems"].append(
                "ctranslate2 reports 0 CUDA devices (CUDA runtime or GPU unavailable)"
            )
            result["hints"].append(
                "Verify NVIDIA GPU driver and CUDA 12 runtime are properly installed"
            )
        else:
            result["available"] = True
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        result["error"] = err_msg
        result["problems"].append(f"ctranslate2 CUDA query failed: {err_msg}")
        result["hints"].append(
            "Check that CUDA 12.x and cuDNN 9 runtime libraries are accessible"
        )

    return result


def _find_dll_on_windows(dll_name: str) -> str | None:
    """Search for a specific DLL in PATH, CUDA_PATH, site-packages, and standard locations."""
    # 1. PATH lookup
    found = shutil.which(dll_name)
    if found:
        return str(Path(found).resolve())

    # 2. %CUDA_PATH%\bin
    cuda_path = os.environ.get("CUDA_PATH")
    if cuda_path:
        cand = Path(cuda_path) / "bin" / dll_name
        if cand.is_file():
            return str(cand.resolve())

    # 3. Virtual environment / Python prefix
    prefix = Path(sys.prefix)
    venv_cand = prefix / "bin" / dll_name
    if venv_cand.is_file():
        return str(venv_cand.resolve())

    site_packages = prefix / "Lib" / "site-packages"
    if site_packages.is_dir():
        for cand in site_packages.glob(f"**/{dll_name}"):
            if cand.is_file():
                return str(cand.resolve())

    # 4. Standard CUDA installation directories
    cuda_root = Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA")
    if cuda_root.is_dir():
        for cand in cuda_root.glob(f"*/bin/{dll_name}"):
            if cand.is_file():
                return str(cand.resolve())

    return None


def detect_runtime_dlls() -> dict[str, Any]:
    """Detect cuBLAS 12 and cuDNN 9 DLLs on Windows runtime."""
    if sys.platform != "win32":
        return {
            "status": "skipped",
            "platform": sys.platform,
            "all_found": True,
            "dlls": {
                dll: {"found": False, "path": None, "status": "skipped"}
                for dll in TARGET_DLLS
            },
            "problems": [],
            "hints": [],
        }

    dll_results: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    hints: list[str] = []

    for dll_name in TARGET_DLLS:
        dll_path = _find_dll_on_windows(dll_name)
        if dll_path:
            dll_results[dll_name] = {"found": True, "path": dll_path}
        else:
            dll_results[dll_name] = {"found": False, "path": None}
            problems.append(f"Missing required runtime DLL: {dll_name}")
            if "cublas" in dll_name.lower():
                hint = (
                    f"Ensure CUDA 12.x bin directory containing {dll_name} "
                    "is added to the system PATH."
                )
            else:
                hint = (
                    f"Ensure cuDNN 9 bin directory containing {dll_name} "
                    "is added to the system PATH, or copy it into your CUDA bin directory."
                )
            if hint not in hints:
                hints.append(hint)

    all_found = all(info["found"] for info in dll_results.values())
    return {
        "status": "checked",
        "platform": sys.platform,
        "all_found": all_found,
        "dlls": dll_results,
        "problems": problems,
        "hints": hints,
    }


def run_preflight() -> dict[str, Any]:
    """Execute complete GPU, CUDA runtime, and DLL preflight inspection."""
    gpu_info = detect_gpu()
    cuda_info = detect_cuda()
    dlls_info = detect_runtime_dlls()

    problems: list[str] = []
    hints: list[str] = []

    problems.extend(gpu_info.pop("problems", []))
    for h in gpu_info.pop("hints", []):
        if h not in hints:
            hints.append(h)

    problems.extend(cuda_info.pop("problems", []))
    for h in cuda_info.pop("hints", []):
        if h not in hints:
            hints.append(h)

    problems.extend(dlls_info.pop("problems", []))
    for h in dlls_info.pop("hints", []):
        if h not in hints:
            hints.append(h)

    ok = len(problems) == 0

    return {
        "ok": ok,
        "platform": sys.platform,
        "gpu": gpu_info,
        "cuda": cuda_info,
        "dlls": dlls_info,
        "problems": problems,
        "hints": hints,
    }
