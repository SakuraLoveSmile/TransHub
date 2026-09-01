# TransferHub API Contract v1

本文冻结面向本地客户端的第一版稳定 API。除非发布新的 API 版本，Stable API v1 的路径、响应字段和错误码保持兼容。

## Stable API v1

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | 正式健康检查 |
| `GET` | `/api/status` | 当前运行状态 |
| `GET` | `/api/models` | 模型目录与加载状态 |
| `POST` | `/api/models/load` | 加载指定模型 |
| `POST` | `/api/models/unload` | 卸载当前模型 |
| `POST` | `/api/transcribe` | 转录音频 |
| `POST` | `/api/translate-audio` | 音频翻译 |
| `GET` | `/api/output/{name}` | 读取服务生成的 JSON/SRT 产物 |

`/api/translate-audio` 是正式翻译接口。本版本不新增或承诺 `/api/translate`。

### Health

`GET /health` returns HTTP `200`:

```json
{
  "status": "ok",
  "service": "transferhub",
  "version": "0.1.0"
}
```

`status` 固定为 `"ok"`，`service` 固定为 `"transferhub"`，`version` 为当前应用版本且非空。

### Runtime and model responses

`GET /api/status` 返回 `status`、`engine`、`mock`、`loaded_model`、`device`。`status` 当前只取 `idle` 或 `running`。

`GET /api/models` 返回 `{ "models": [...] }`。每个模型项至少包含 `id`、`name`、`type`、`installed`、`loaded`、`mock`。

模型加载/卸载继续使用现有 `LoadModelResponse`、`UnloadModelResponse` 结构；本阶段不重新设计模型字段。

### Inference result

`POST /api/transcribe` 和 `POST /api/translate-audio` 成功时使用同一基础结果结构，并按接口使用语言字段：

```text
success
mock
profile
model
duration
processing_time
realtime_factor
speed
text
segments
```

转录响应额外包含 `language`；音频翻译响应额外包含 `source_language`、`target_language`。响应使用 `response_model_exclude_none=True`，因此未使用的可选语言字段不会出现在 JSON 中。

每个 `segments` 项包含 `start`、`end`、`text`。

`InferenceResult` 不包含 GPU、CUDA、模型路径或引擎调试信息；这些信息属于 `/api/status` 或本地 diagnostics。

### Output safety

`GET /api/output/{name}` 只接受 bare filename，并且只允许 `.json` 和 `.srt`。服务会拒绝目录跳转；解析后的路径必须仍位于 output directory 内。不存在的产物返回 `OUTPUT_NOT_FOUND`。

## Error contract

项目自己的错误返回 HTTP 状态码和以下结构：

```json
{
  "code": "ENGINE_BUSY",
  "detail": "Inference engine is busy"
}
```

`code` 是客户端使用的稳定 `UPPER_SNAKE_CASE` 标识；`detail` 仅用于人类可读说明。FastAPI/Pydantic 自动生成的请求校验 `422` 仍使用现有 validation response，不属于本节的 `AppError` 结构。

| Exception | HTTP | Code |
| --- | ---: | --- |
| `UnknownProfileError` | 404 | `UNKNOWN_PROFILE` |
| `UnknownModelError` | 404 | `UNKNOWN_MODEL` |
| `ModelNotInstalledError` | 404 | `MODEL_NOT_INSTALLED` |
| `EngineBusyError` | 409 | `ENGINE_BUSY` |
| `DownloadBusyError` | 409 | `DOWNLOAD_BUSY` |
| `InvalidPathError` | 422 | `INVALID_PATH` |
| `UnsupportedFileError` | 400 | `UNSUPPORTED_FILE` |
| `OutputNotFoundError` | 404 | `OUTPUT_NOT_FOUND` |
| `ModelLoadError` | 503 | `MODEL_LOAD_FAILED` |
| `InferenceError` | 500 | `INFERENCE_FAILED` |

## Legacy API

`GET /api/health` 保留为旧客户端兼容接口，继续返回：

```json
{"status": "ok"}
```

Deprecated / legacy compatibility only. New clients MUST use `GET /health`.

## Local Setup / Diagnostics API

以下接口用于本机环境体检和模型下载，不属于 Stable API v1：

```text
GET  /api/setup/env
POST /api/setup/download
GET  /api/setup/download
```

它们是 Local setup / diagnostics API，不承诺长期兼容。`/diagnostics.html` 是人工验收页面，不是客户端 API。

## Existing `/v1/*` task API

现有 SAK-31/32 的 `/v1/transcriptions`、`/v1/tasks/{task_id}`、`/v1/translations` 任务接口保持原状。本次不会把它们迁移到其他前缀，也不新增 Job、Streaming 或认证能力。
