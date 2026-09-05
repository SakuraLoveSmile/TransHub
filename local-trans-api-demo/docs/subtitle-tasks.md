# 统一字幕任务 API（初步可用版本）

本文档描述 `POST /api/subtitle-tasks` 为入口的统一异步字幕链路。
旧同步接口（`/api/transcribe`、`/api/translate-audio`）与 `/v1/*`
Mock 任务链保持兼容，不受影响。

## 处理模式

| `mode` | 意义 | 内部 profile |
|---|---|---|
| `transcribe` | 日语转录 | `ja-transcribe` |
| `translate` | 日语音频翻译成中文 | `ja-zh` |

任务成功后同时提供 SRT 与 LRC，切换格式无需重新推理。

## 接口

| 方法与路径 | 说明 |
|---|---|
| `POST /api/subtitle-tasks` | multipart：`file`、`mode`；返回 HTTP 202 任务记录 |
| `GET /api/subtitle-tasks?limit=20&offset=0` | 按创建时间倒序的任务列表（limit 最大 100） |
| `GET /api/subtitle-tasks/{id}` | 状态、结果摘要、下载地址或错误 |
| `GET /api/subtitle-tasks/{id}/file?format=srt\|lrc` | UTF-8 字幕附件（默认 srt） |

状态：`status` 为 `queued / running / succeeded / failed`；
`stage` 为 `queued / loading_model / processing / writing_output / completed / failed`。
成功前 `result`、`downloads` 为 `null`；失败时 `error` 为 `{code, detail}`。
时间统一为 UTC（`...Z`）。`mock` 明确返回，前端须醒目标注模拟模式。
下载地址为相对路径，不暴露服务器内部文件路径。

## 错误契约

新接口统一返回 `{code, detail}`（`detail` 为可读中文，不含堆栈与内部路径）：

| 情况 | HTTP / 错误码 |
|---|---|
| 不支持的格式、空文件 | 400 / `UNSUPPORTED_FILE`、`EMPTY_FILE` |
| 超过上传上限（默认 2 GiB） | 413 / `FILE_TOO_LARGE` |
| 非法 mode、format 或请求字段 | 422 / `INVALID_REQUEST` |
| 三个等待位置已占满 | 409 / `QUEUE_FULL` |
| 模型未安装 | 404 / `MODEL_NOT_INSTALLED` |
| 任务不存在或已过期清理 | 404 / `TASK_NOT_FOUND` |
| 任务尚未成功，尝试下载 | 409 / `RESULT_NOT_READY` |
| 已完成任务的产物意外丢失 | 410 / `RESULT_MISSING` |

后台推理失败通过任务的 `error` 返回（`MODEL_LOAD_FAILED`、
`INFERENCE_FAILED`、`OUTPUT_WRITE_FAILED`、`SERVICE_RESTARTED`），
查询接口本身不变成 HTTP 500。

## 队列与运行约束

- 每个任务一个音视频；最多一个执行、三个等待（含上传预留位）。
- 单进程、单 Uvicorn worker；新任务 worker 与旧同步接口共用同一引擎锁。
  旧接口忙时仍返回 `409 ENGINE_BUSY`，新 worker 等待锁（等待期间保持 `queued`）。
- 任务记录使用 SQLite（`data/tasks.sqlite3`），重启后可查询已完成任务；
  字幕与终态记录保留七天（从成功或失败时间起算），启动时与每小时清理过期任务。
- 未完成任务在重启后标记为 `failed / SERVICE_RESTARTED`，不自动重跑。
- 正常退出时停止接收新任务，排队任务标记失败，等待正在执行的推理完成。

## 字幕格式

- SRT 沿用现有毫秒格式与段落编号。
- LRC 每个 segment 一行，使用开始时间（`[mm:ss.cc]`，分钟可超过 59）；
  不表达结束时间，不声称逐字卡拉 OK 时间轴。
- 空识别结果仍可成功（空字幕），前端提示“未识别到语音”。
- UTF-8、LF 换行；下载名为 `<原文件主名>.ja.srt` / `<原文件主名>.zh.lrc`。

## 其他软件调用（Windows）

上传：

```powershell
curl.exe --fail-with-body `
  -F "file=@D:\Audio\sample.flac" `
  -F "mode=translate" `
  http://127.0.0.1:8765/api/subtitle-tasks
```

保存返回的 `id`，随后查询并下载（标准库示例见
`scripts/subtitle_task_client_example.py`）。查询超时后继续查询原编号，
不自动重新上传；`QUEUE_FULL` 表示本次没有创建任务，可稍后手动重试。

## Vue 前端

- 开发：`cd frontend && npm ci && npm run dev`（Vite 将 `/api`、`/health`
  代理到 `127.0.0.1:8765`）。
- 生产构建：根目录 `build-web.bat`（依次执行 `npm ci`、测试、类型检查、构建）；
  FastAPI 托管 `frontend/dist`，构建产物缺失时回退到现有静态页，
  `/diagnostics.html` 始终可访问。
- Node 仅用于前端开发与构建，正常运行只需 Python 与已构建静态文件。

## 配置

`config.toml`（与 `config.real.example.toml`）新增：

```toml
[subtitle_tasks]
data_directory = "./data"
max_upload_bytes = 2147483648
max_waiting = 3
retention_days = 7
```

也可用环境变量 `TRANSFERHUB_MAX_UPLOAD_BYTES` 覆盖上传上限。
运行数据目录（`data/`）已加入 Git 忽略规则。
