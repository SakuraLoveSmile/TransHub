# Windows GPU Runtime Preflight

TransHub 的真实 `faster-whisper` 推理环境是 Windows + NVIDIA GPU + CUDA-only。
Runtime Preflight 在真实模型加载前检查 CUDA 设备和 CUDA 12.x / cuDNN 9 所需的 DLL，
让缺失运行时、DLL 不存在和 DLL 架构不匹配等问题有不同的诊断结果。

## 检查内容

Preflight 会按以下顺序工作：

1. 发现 CUDA、cuDNN 和 pip NVIDIA wheel 的 DLL 目录。
2. 使用 Windows 的 `os.add_dll_directory` 自动注册发现的目录，并在进程内保留句柄。
   注册是幂等的，不需要手工修改 `PATH`。
3. 查询 `ctranslate2` 的 CUDA device count。
4. 逐个加载以下固定 ABI 名称，确认 DLL 不仅存在而且能被当前 Python 进程加载：

```text
cublas64_12.dll
cublasLt64_12.dll
cudnn64_9.dll
```

启动时只做目录注册，不做 DLL 加载探测，因此 Mock/CI 启动不会因为真实 GPU 环境缺失而失败。
真实引擎在 `WhisperModel` 加载前执行完整 preflight。

## 自动发现目录

目录按环境变量和版本优先级搜索：

- `%CUDA_PATH%\bin`
- `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v*\bin`
- `C:\Program Files\NVIDIA\CUDNN\v*\bin\*\x64`
- `C:\Program Files\NVIDIA\CUDNN\v*\x64`
- `<sys.prefix>\Lib\site-packages\nvidia\*\bin`（pip wheel）
- `PATH` 中实际包含任一所需 DLL 的目录

版本目录使用 `v*` 匹配并优先较新的版本，不锁定单个 CUDA/cuDNN 安装版本。
正常情况下不需要手工把 CUDA 或 cuDNN 目录加入 `PATH`。

## 分类码与下一步

| code | 含义 | 下一步 |
| --- | --- | --- |
| `RUNTIME_OK` | CUDA device 和三个所需 DLL 均可用 | 可以加载真实模型并运行 Phase 2/3 checker。 |
| `NOT_WINDOWS` | 当前平台不是 Windows | 真实 CUDA 推理必须在 Windows + NVIDIA 环境验证；macOS/Linux 只可运行 Mock 或单测。 |
| `NO_NVIDIA_GPU` | `ctranslate2` 查询到 0 个 CUDA device | 安装/更新 NVIDIA 驱动，或改用有 NVIDIA GPU 的 Windows 机器。 |
| `CUDA_DEVICE_UNAVAILABLE` | `ctranslate2` 缺失或无法查询 CUDA device | 安装 CUDA-enabled `ctranslate2`，并检查 NVIDIA 驱动与 CUDA runtime。 |
| `CUDA_TOOLKIT_NOT_FOUND` | 没有发现任何候选 DLL 目录 | 安装 CUDA 12.x 和 cuDNN 9，或设置 `CUDA_PATH` 指向 CUDA 安装目录。 |
| `CUBLAS_DLL_NOT_FOUND` | `cublas64_12.dll` 或 `cublasLt64_12.dll` 不存在 | 安装 CUDA 12.x，并确认 `CUDA_PATH` 的 `bin` 目录可发现。 |
| `CUDNN_DLL_NOT_FOUND` | `cudnn64_9.dll` 不存在 | 安装 cuDNN 9 for CUDA 12，并确认其 x64 目录可发现。 |
| `DLL_LOAD_FAILED` | DLL 文件存在但 Windows 加载失败 | 核对 CUDA/cuDNN 版本、Python/系统架构和 DLL 依赖是否匹配。 |

提示中会同时带上分类码和可执行的下一步。分类码只用于 diagnostics 和模型加载失败详情，
不会加入 Stable API v1 的 `/api/status` 或 inference 响应。

## Diagnostics API

`GET /api/setup/env` 返回的 `runtime_preflight` 是本地诊断字段，不属于 Stable API v1：

```json
{
  "runtime_preflight": {
    "code": "RUNTIME_OK",
    "ok": true,
    "platform": "win32",
    "cuda_devices": 1,
    "registered_directories": [
      "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4\\bin"
    ],
    "candidate_directories": [
      "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4\\bin"
    ],
    "dlls": [
      {
        "name": "cublas64_12.dll",
        "found": true,
        "loaded": true,
        "path": "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4\\bin\\cublas64_12.dll",
        "error": null
      },
      {
        "name": "cublasLt64_12.dll",
        "found": true,
        "loaded": true,
        "path": "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4\\bin\\cublasLt64_12.dll",
        "error": null
      },
      {
        "name": "cudnn64_9.dll",
        "found": true,
        "loaded": true,
        "path": "C:\\Program Files\\NVIDIA\\CUDNN\\v9.5\\bin\\12.6\\x64\\cudnn64_9.dll",
        "error": null
      }
    ],
    "message": "RUNTIME_OK: CUDA device and required cuBLAS/cuDNN DLLs are available for faster-whisper."
  }
}
```

`/diagnostics.html` 展示分类码、消息和每个 DLL 的 `found/loaded` 状态。无 GPU、非 Windows
或依赖缺失时页面会保留可读的下一步提示。

## Windows 验收

启动服务后先查看：

```powershell
curl http://127.0.0.1:8765/api/setup/env
```

真实推理前应看到 `runtime_preflight.code` 为 `RUNTIME_OK`，然后继续执行：

```powershell
.venv\Scripts\python scripts\phase2_check.py --file "D:\ASMR\test.flac" --expect-device cuda
.venv\Scripts\python scripts\phase3_check.py --file "D:\ASMR\test.flac"
```

如果需要绕过应用诊断直接检查 Windows loader，仍可使用：

```powershell
where.exe cublas64_12.dll
where.exe cublasLt64_12.dll
where.exe cudnn64_9.dll
```

这些命令是兜底手段；应用主流程会自动发现并注册 DLL 目录，不要求手工修改 `PATH`。
