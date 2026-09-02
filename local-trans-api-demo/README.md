# TransferHub

TransferHub 是 Windows 本地运行的转录 / 翻译 API 中枢，为本机其他服务提供统一入口。

## 当前阶段：真实转录 MVP（Windows + NVIDIA CUDA）

当前版本完成了「打开网页 → 选一个本地音频文件 → 得到真实日语转录字幕」的闭环：

- 主页面直接选择本地音频/视频文件（`.wav/.flac/.mp3/.m4a/.aac/.ogg/.opus/.mp4/.mkv/.webm`），浏览器上传到本机服务（`POST /api/upload`）后再转录。
- 真实引擎为 `faster-whisper` + `whisper-ja-1.5b`（CUDA/CPU fallback），通过 `config.real.toml` 启用（模板见 `config.real.example.toml`）。
- 转录结果可在线预览、复制文本、下载 SRT 字幕；JSON/SRT 产物同时落在 `./output`。
- 默认 `config.toml` 仍走 Mock 引擎，用于开发与基础测试，不加载真实模型。
- 日→中翻译（ChickenRice）与 Phase 3 质量评估明确留作后续。

Mock 链路只验证流程、字段与错误码；真实转录验收在 Windows + NVIDIA 机器上进行（见「启用真实引擎」）。

当前版本只验证本地 HTTP 服务的基础结构：

- FastAPI + Uvicorn 服务可以启动和退出。
- `GET /health` 提供基础健康检查。
- 转录和翻译都有独立的 Provider 边界。
- 默认使用 Mock Provider，不加载真实 AI 模型。
- `/api/*` 提供稳定的客户端 API Contract v1；默认使用 Mock Engine。
- 页面「选文件」通过 `POST /api/upload` 把文件保存到本机 `uploads/`，再走 `/api/transcribe`。
- `/v1` 的 SAK-31/32 任务生命周期接口继续保留，不在本阶段迁移。

SAK-31 定义 HTTP、请求、响应和错误模型；SAK-32 增加内存任务生命周期，但不引入数据库、消息队列或真实 AI Provider。

## Windows PowerShell 启动

在 PowerShell 中执行：

```powershell
cd .\local-trans-api-demo
.\setup.bat
.\run.bat
```

服务默认监听 `127.0.0.1:8765`。`run.bat` 会在前台运行服务，按 `Ctrl+C` 可正常停止。

也可以直接使用 Python 模块入口：

```powershell
python -m app.main
```

运行命令前请确保当前目录是 `local-trans-api-demo`，并已安装 `requirements.txt` 中的依赖。

## 网页选文件（浏览器上传）

浏览器与本机服务同机，浏览器拿不到绝对路径，所以「选本地文件」走两步：

1. 打开 `http://127.0.0.1:8765/`，在页面主输入框选择一个本地音频/视频文件（也可在「高级：直接填服务器路径」里直接填服务端路径作 fallback）。
2. 点 **Run**：文件先 `POST /api/upload` 保存到 `uploads/`（文件名 `{uuid}-{原名}`），拿到服务端路径后再 `POST /api/transcribe`；转录完成后可复制文本或下载 SRT。

命令行等价流程（Mock 同样适用，仅验证流程/字段/错误码）：

```powershell
curl -F "file=@D:\ASMR\test.flac" http://127.0.0.1:8765/api/upload
curl -X POST http://127.0.0.1:8765/api/transcribe -H "Content-Type: application/json" -d "{\"path\":\"<上一步返回的 path>\"}"
```

上传接口只接受 `.wav/.flac/.mp3/.m4a/.aac/.ogg/.opus/.mp4/.mkv/.webm`，其余后缀返回 `400 UNSUPPORTED_FILE`；保存名会剔除 `[A-Za-z0-9._-]` 以外的字符，无法跳出 `uploads/` 目录。

## 配置

配置通过环境变量提供，默认值如下：

```text
TRANSFERHUB_HOST=127.0.0.1
TRANSFERHUB_PORT=8765
TRANSFERHUB_LOG_LEVEL=INFO
TRANSFERHUB_MOCK_TRANSCRIPTION_DELAY=0.2
TRANSFERHUB_MOCK_TRANSCRIPTION_FAIL=false
```

PowerShell 示例：

```powershell
$env:TRANSFERHUB_HOST = "127.0.0.1"
$env:TRANSFERHUB_PORT = "8765"
$env:TRANSFERHUB_LOG_LEVEL = "INFO"
python -m app.main
```

默认只监听本机回环地址，不暴露到局域网。可复制 `.env.example` 作为配置参考；当前 Demo 不自动读取 `.env` 文件。

## API Contract

完整字段、错误码和 Stable / Legacy / Diagnostics 边界见 [`docs/api-contract-v1.md`](docs/api-contract-v1.md)。

### Stable API v1

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 正式健康检查 |
| GET | `/api/status` | 运行状态 |
| GET | `/api/models` | 模型列表 |
| POST | `/api/models/load` | 加载模型 |
| POST | `/api/models/unload` | 卸载模型 |
| POST | `/api/transcribe` | 音频转录 |
| POST | `/api/translate-audio` | 音频翻译 |
| GET | `/api/output/{name}` | 读取 JSON/SRT 产物 |

### Legacy API

`GET /api/health` 继续保留，返回 `{"status":"ok"}`，仅用于旧客户端兼容。新客户端必须使用 `GET /health`。

### Local Setup / Diagnostics API

`GET /api/setup/env`、`POST /api/setup/download`、`GET /api/setup/download`、`POST /api/upload` 和 `/diagnostics.html` 仅供本机设置与诊断，不属于 Stable API v1，不承诺长期兼容。`/api/upload` 是网页「选文件」的支撑端点。

`/api/*` 项目错误返回 `{ "code": "...", "detail": "..." }`；FastAPI/Pydantic 自动生成的校验错误保持原有格式。

## 启用真实引擎（Windows + NVIDIA CUDA）

真实 `faster-whisper` 与 CUDA 路径只在 Windows + NVIDIA 机器上运行（开发/CI 继续用 Mock）。

```powershell
copy config.real.example.toml config.real.toml
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\pip install -r requirements-ai.txt
python scripts\download_models.py --model whisper-ja-1.5b
set TRANS_HUB_CONFIG=%CD%\config.real.toml
run.bat
```

`config.real.toml` 与 `config.toml` 的差异只有引擎开关：`engine = "faster-whisper"`、`[faster_whisper] device = "cuda"`、`compute_type = "float16"`；`config.real.toml` 保持本地不入库（已在 `.gitignore`），仓库只提交 `config.real.example.toml` 模板。

启动后 `GET /api/status` 应为 `engine=faster-whisper`、`mock=false`、`device=cuda`。完整验收步骤见 [`docs/phase2-windows-nvidia.md`](docs/phase2-windows-nvidia.md)，自动验收入口：

```text
python scripts\phase2_check.py --file "D:\ASMR\test.flac" --model whisper-ja-1.5b --language ja --expect-device cuda
```

该阶段只做真实转录链路和设备验收（日→中翻译的 ChickenRice / Phase 3 留作后续）。

## Health Check

服务启动后执行：

```powershell
curl http://127.0.0.1:8765/health
```

预期返回 HTTP 200：

```json
{
  "status": "ok",
  "service": "transferhub",
  "version": "0.1.0"
}
```

## Existing task API (`/v1`)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/transcriptions` | 校验请求、创建异步任务并返回初始 `queued` 状态，状态码 `202` |
| GET | `/v1/tasks/{task_id}` | 查询内存中的任务状态和结果；不存在时返回 `404` |
| POST | `/v1/translations` | 返回可预测的任务翻译 Contract，状态码 `200` |

这些接口保持现状；本阶段不做 `/v1/` URL 前缀迁移。新的稳定客户端音频翻译接口是 `/api/translate-audio`。

`/v1` 校验错误统一返回 `error.code`、`error.message` 和 `error.details`，不会返回 FastAPI 默认的 `detail` 数组。

### Mock 转录任务

转录任务会异步经历 `queued → running → completed`，Provider 异常时经历 `queued → running → failed`。Mock 不读取或解码输入文件，只校验 `input.type` 为 `file` 且 `input.path` 非空。

`TRANSFERHUB_MOCK_TRANSCRIPTION_DELAY` 控制模拟延迟，单位为秒，默认 `0.2`；`TRANSFERHUB_MOCK_TRANSCRIPTION_FAIL=true` 可用于验证失败状态。任务只保存在内存中，服务重启后会丢失。

## 测试

安装测试依赖并运行：

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

测试会验证 `/health`、v1 Contract、统一错误结构、OpenAPI 路径和应用的启动 / 关闭生命周期。

## 目录结构

```text
local-trans-api-demo/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── api/
│   │   ├── health.py
│   │   └── v1.py
│   ├── core/
│   │   └── errors.py
│   ├── schemas/
│   │   └── v1.py
│   ├── services/
│   │   ├── task_store.py
│   │   └── transcription_service.py
│   └── providers/
│       ├── transcription.py
│       ├── translation.py
│       └── mock/
│           ├── transcription.py
│           └── translation.py
├── tests/
│   ├── test_health.py
│   └── test_v1_contract.py
├── .env.example
├── pyproject.toml
├── requirements.txt
└── requirements-dev.txt
```

## 后续范围

以下内容有意留给后续 Issue：

- SAK-33：完整转录到翻译 Demo
- SAK-34：真实 AI Provider 与模型接入
