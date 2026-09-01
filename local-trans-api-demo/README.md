# TransferHub

TransferHub 是 Windows 本地运行的转录 / 翻译 API 中枢，为本机其他服务提供统一入口。

## 当前阶段：API Contract v1 + M0 Mock Task Lifecycle

当前版本只验证本地 HTTP 服务的基础结构：

- FastAPI + Uvicorn 服务可以启动和退出。
- `GET /health` 提供基础健康检查。
- 转录和翻译都有独立的 Provider 边界。
- 默认使用 Mock Provider，不加载真实 AI 模型。
- `/api/*` 提供稳定的客户端 API Contract v1；默认使用 Mock Engine。
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

`GET /api/setup/env`、`POST /api/setup/download`、`GET /api/setup/download` 和 `/diagnostics.html` 仅供本机设置与诊断，不属于 Stable API v1，不承诺长期兼容。

`/api/*` 项目错误返回 `{ "code": "...", "detail": "..." }`；FastAPI/Pydantic 自动生成的校验错误保持原有格式。

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
