"""Windows CUDA runtime discovery and preflight checks."""

from __future__ import annotations

import ctypes
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

REQUIRED_DLLS = (
    "cublas64_12.dll",
    "cublasLt64_12.dll",
    "cudnn64_9.dll",
)

RUNTIME_OK = "RUNTIME_OK"
NOT_WINDOWS = "NOT_WINDOWS"
NO_NVIDIA_GPU = "NO_NVIDIA_GPU"
CUDA_DEVICE_UNAVAILABLE = "CUDA_DEVICE_UNAVAILABLE"
CUDA_TOOLKIT_NOT_FOUND = "CUDA_TOOLKIT_NOT_FOUND"
CUBLAS_DLL_NOT_FOUND = "CUBLAS_DLL_NOT_FOUND"
CUDNN_DLL_NOT_FOUND = "CUDNN_DLL_NOT_FOUND"
DLL_LOAD_FAILED = "DLL_LOAD_FAILED"

LOGGER = logging.getLogger("app.runtime_preflight")
_REGISTERED_DIRECTORIES: set[str] = set()
_DLL_DIRECTORY_HANDLES: dict[str, object | None] = {}


@dataclass(frozen=True)
class DllProbe:
    name: str
    found: bool
    loaded: bool
    path: str | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, object | None]:
        return {
            "name": self.name,
            "found": self.found,
            "loaded": self.loaded,
            "path": self.path,
            "error": self.error,
        }


@dataclass(frozen=True)
class RuntimePreflightReport:
    code: str
    ok: bool
    platform: str
    cuda_devices: int
    registered_directories: list[str]
    candidate_directories: list[str]
    dlls: list[DllProbe]
    message: str

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "ok": self.ok,
            "platform": self.platform,
            "cuda_devices": self.cuda_devices,
            "registered_directories": list(self.registered_directories),
            "candidate_directories": list(self.candidate_directories),
            "dlls": [dll.as_dict() for dll in self.dlls],
            "message": self.message,
        }


def _is_windows() -> bool:
    return sys.platform == "win32"


def _add_dll_directory(directory: Path) -> object | None:
    add_dll_directory = getattr(os, "add_dll_directory", None)
    if add_dll_directory is None:
        return None
    return add_dll_directory(str(directory))


def _load_dll(name: str) -> object:
    win_dll = getattr(ctypes, "WinDLL", None)
    if win_dll is None:
        raise OSError("ctypes.WinDLL is unavailable on this platform")
    return win_dll(name)


def _cuda_device_count() -> int | None:
    """Return the CUDA device count, or None when ctranslate2 cannot query it."""
    try:
        import ctranslate2
    except (AttributeError, ImportError, OSError, RuntimeError, TypeError, ValueError):
        return None

    try:
        return int(ctranslate2.get_cuda_device_count())
    except (AttributeError, ImportError, OSError, RuntimeError, TypeError, ValueError):
        return None


def _is_directory(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        return False


def _is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def _glob_directories(root: Path, pattern: str) -> list[Path]:
    try:
        return [path for path in root.glob(pattern) if _is_directory(path)]
    except OSError:
        return []


def _version_key(path: Path) -> tuple[tuple[int, ...], str]:
    version = ""
    for component in reversed(path.parts):
        if component.lower().startswith("v"):
            version = component[1:]
            break
    numbers: list[int] = []
    for component in version.replace("-", ".").split("."):
        if not component.isdigit():
            break
        numbers.append(int(component))
    return tuple(numbers), path.name.lower()


def _path_key(path: Path) -> str:
    try:
        value = str(path.resolve())
    except OSError:
        value = str(path)
    return os.path.normcase(value)


def _append_unique(paths: list[Path], seen: set[str], path: Path) -> None:
    key = _path_key(path)
    if key in seen:
        return
    seen.add(key)
    paths.append(path)


def _path_entries(value: str) -> list[str]:
    if not value:
        return []
    separators = os.pathsep
    if separators != ";" and ";" in value:
        value = value.replace(";", separators)
    return [entry.strip().strip('"') for entry in value.split(separators) if entry.strip()]


def discover_dll_directories() -> list[Path]:
    """Find existing directories that may contain the CUDA runtime DLLs."""
    if not _is_windows():
        return []

    paths: list[Path] = []
    seen: set[str] = set()

    cuda_path = os.environ.get("CUDA_PATH")
    if cuda_path:
        cuda_bin = Path(cuda_path).expanduser() / "bin"
        if _is_directory(cuda_bin):
            _append_unique(paths, seen, cuda_bin)

    cuda_root = Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA")
    for path in sorted(_glob_directories(cuda_root, "v*/bin"), key=_version_key, reverse=True):
        _append_unique(paths, seen, path)

    cudnn_root = Path("C:/Program Files/NVIDIA/CUDNN")
    cudnn_paths = _glob_directories(cudnn_root, "v*/bin/*/x64")
    cudnn_paths.extend(_glob_directories(cudnn_root, "v*/x64"))
    for path in sorted(cudnn_paths, key=_version_key, reverse=True):
        _append_unique(paths, seen, path)

    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    for path in sorted(
        _glob_directories(site_packages, "nvidia/*/bin"),
        key=lambda item: item.as_posix().lower(),
    ):
        _append_unique(paths, seen, path)

    for raw_directory in _path_entries(os.environ.get("PATH", "")):
        directory = Path(raw_directory)
        if not _is_directory(directory):
            continue
        if any(_is_file(directory / name) for name in REQUIRED_DLLS):
            _append_unique(paths, seen, directory)

    return paths


def register_dll_directories() -> list[str]:
    """Register discovered DLL directories and retain their handles for the process."""
    if not _is_windows():
        return []

    registered: list[str] = []
    for directory in discover_dll_directories():
        key = _path_key(directory)
        if key in _REGISTERED_DIRECTORIES:
            registered.append(str(directory))
            continue
        try:
            handle = _add_dll_directory(directory)
        except (OSError, RuntimeError) as error:
            LOGGER.warning("Could not register CUDA DLL directory %s: %s", directory, error)
            continue
        _REGISTERED_DIRECTORIES.add(key)
        _DLL_DIRECTORY_HANDLES[key] = handle
        registered.append(str(directory))
    return registered


def _empty_dll_probes(error: str | None = None) -> list[DllProbe]:
    return [
        DllProbe(name=name, found=False, loaded=False, error=error)
        for name in REQUIRED_DLLS
    ]


def _report(
    code: str,
    platform: str,
    cuda_devices: int,
    registered: list[str],
    candidates: list[Path],
    dlls: list[DllProbe],
    message: str,
) -> RuntimePreflightReport:
    return RuntimePreflightReport(
        code=code,
        ok=code == RUNTIME_OK,
        platform=platform,
        cuda_devices=cuda_devices,
        registered_directories=registered,
        candidate_directories=[str(path) for path in candidates],
        dlls=dlls,
        message=f"{code}: {message}",
    )


def _find_dll(name: str, candidates: list[Path]) -> Path | None:
    for directory in candidates:
        path = directory / name
        if _is_file(path):
            return path
    return None


def _classify_missing(dlls: list[DllProbe]) -> tuple[str, str] | None:
    missing = {dll.name for dll in dlls if not dll.found}
    cublas_missing = [name for name in REQUIRED_DLLS[:2] if name in missing]
    if cublas_missing:
        return (
            CUBLAS_DLL_NOT_FOUND,
            "Could not find "
            + ", ".join(cublas_missing)
            + "; install CUDA 12.x or set CUDA_PATH to a CUDA installation.",
        )
    if REQUIRED_DLLS[2] in missing:
        return (
            CUDNN_DLL_NOT_FOUND,
            (
                "Could not find cudnn64_9.dll; install cuDNN 9 for CUDA 12 and make its "
                "x64 directory discoverable."
            ),
        )
    return None


def probe_runtime() -> RuntimePreflightReport:
    """Discover, register, and load-test the CUDA runtime required by faster-whisper."""
    platform = sys.platform
    if not _is_windows():
        return _report(
            NOT_WINDOWS,
            platform,
            0,
            [],
            [],
            _empty_dll_probes(),
            "Real CUDA inference is supported only on Windows with an NVIDIA GPU.",
        )

    registration_error: str | None = None
    try:
        registered = register_dll_directories()
    except Exception as error:  # noqa: BLE001 - diagnostics must remain non-fatal
        registered = []
        registration_error = f"{type(error).__name__}: {error}"

    candidates = discover_dll_directories()
    device_count = _cuda_device_count()
    if device_count is None:
        return _report(
            CUDA_DEVICE_UNAVAILABLE,
            platform,
            0,
            registered,
            candidates,
            _empty_dll_probes(),
            "ctranslate2 is missing or could not query CUDA devices; install a CUDA-enabled "
            "ctranslate2 and verify the NVIDIA driver and CUDA runtime.",
        )
    if device_count <= 0:
        return _report(
            NO_NVIDIA_GPU,
            platform,
            0,
            registered,
            candidates,
            _empty_dll_probes(),
            "ctranslate2 detected no NVIDIA CUDA device; install the NVIDIA driver or use a "
            "Windows machine with a supported NVIDIA GPU.",
        )
    if not candidates:
        detail = "Install CUDA 12.x and cuDNN 9, or set CUDA_PATH to the CUDA installation."
        if registration_error:
            detail += f" DLL directory registration also failed ({registration_error})."
        return _report(
            CUDA_TOOLKIT_NOT_FOUND,
            platform,
            device_count,
            registered,
            candidates,
            _empty_dll_probes("No candidate DLL directory was found."),
            detail,
        )

    dlls: list[DllProbe] = []
    for name in REQUIRED_DLLS:
        path = _find_dll(name, candidates)
        if path is None:
            dlls.append(
                DllProbe(
                    name=name,
                    found=False,
                    loaded=False,
                    error="DLL was not found in candidate directories.",
                )
            )
            continue
        try:
            _load_dll(name)
        except Exception as error:  # noqa: BLE001 - report the exact DLL failure
            dlls.append(
                DllProbe(
                    name=name,
                    found=True,
                    loaded=False,
                    path=str(path),
                    error=f"{type(error).__name__}: {error}",
                )
            )
        else:
            dlls.append(DllProbe(name=name, found=True, loaded=True, path=str(path)))

    load_failures = [dll for dll in dlls if dll.found and not dll.loaded]
    if load_failures:
        names = ", ".join(dll.name for dll in load_failures)
        return _report(
            DLL_LOAD_FAILED,
            platform,
            device_count,
            registered,
            candidates,
            dlls,
            f"Could not load {names}; check CUDA/cuDNN version and x64 architecture "
            "compatibility.",
        )

    missing = _classify_missing(dlls)
    if missing:
        code, detail = missing
        return _report(
            code,
            platform,
            device_count,
            registered,
            candidates,
            dlls,
            detail,
        )

    return _report(
        RUNTIME_OK,
        platform,
        device_count,
        registered,
        candidates,
        dlls,
        "CUDA device and required cuBLAS/cuDNN DLLs are available for faster-whisper.",
    )
