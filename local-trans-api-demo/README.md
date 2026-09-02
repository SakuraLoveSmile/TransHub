# TransHub

TransHub 是 Windows 本地运行的转录 / 语音翻译 API 中枢，为本机其他软件提供统一的 AI 音频处理入口。

## 当前阶段：Phase 3 完成，进入产品化阶段

当前核心 MVP 已完成真实模型链路验证：

- FastAPI + Uvicorn 本地服务可启动和退出。
- Stable API Contract v1 已冻结。
- Mock Engine 保留用于开发、测试和 CI。
- `FasterWhisperEngine` 已接入真实模型。
- `whisper-ja-1.5b` 已完成 Windows + NVIDIA CUDA 真机转录验收。
- `ChickenRice v2` 已完成 Windows + NVIDIA CUDA 日语→中文真实翻译链路验收。
- JSON / SRT 输出、segments 时间轴和性能指标已进入自动 checker。
- Windows smoke CI 持续验证基础回归。

TransHub 的正式真实推理环境为 **Windows + NVIDIA GPU + CUDA-only**，不提供 CPU inference fallback。

翻译质量的主观评价不作为 TransHub 的工程验收门槛。Phase 3 只保证真实翻译链路、API Contract、输出文件与基础结果结构可用；具体模型翻译质量由模型本身和实际业务场景决定。

## 架构

```text
Client / Web UI
      ↓
FastAPI
      ↓
InferenceService
      ↓
Engine Interface
      ├─ MockEngine
      └─ FasterWhisperEngine
             ├─ whisper-ja-1.5b
             └─ chickenrice-v2
```

服务默认只监听 `127.0.0.1`，并接受本机文件路径。不要直接暴露到 LAN/WAN。

## Windows PowerShell 启动

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

## 配置

配置通过环境变量和项目配置提供。基础环境变量默认值：

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

真实推理使用 NVIDIA CUDA。缺少可用 GPU / CUDA Runtime 时应明确失败，不会自动降级到 CPU。

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
| POST | `/api/transcribe` | 日语音频转录 |
| POST | `/api/translate-audio` | 日语→中文音频翻译 |
| GET | `/api/output/{name}` | 读取 JSON/SRT 产物 |

### Legacy API

`GET /api/health` 继续保留，仅用于旧客户端兼容。新客户端必须使用 `GET /health`。

`/v1` 的 SAK-31/32 内存任务生命周期接口继续保留，暂不迁移。

### Local Setup / Diagnostics API

`GET /api/setup/env`、`POST /api/setup/download`、`GET /api/setup/download` 和 `/diagnostics.html` 仅供本机设置与诊断，不属于 Stable API v1，不承诺长期兼容。

## Phase 2：真实日语转录

真实 `faster-whisper`、`whisper-ja-1.5b` 与 NVIDIA CUDA 的完整验收步骤见 [`docs/phase2-windows-nvidia.md`](docs/phase2-windows-nvidia.md)。

Phase 2 已完成 Windows + NVIDIA CUDA 真机验收。真实 19 分钟级日语音频已经完成模型加载、转录、segments、JSON/SRT 与 API Contract 验证。

## Phase 3：ChickenRice 日语→中文翻译

Phase 3 已完成真实 ChickenRice v2 CUDA 翻译链路验证。

自动验收脚本：

```powershell
.venv\Scripts\python scripts\phase3_check.py --file "C:\ASMR\sample.wav"
```

checker 验证：

- 服务使用真实 `faster-whisper` engine，而非 Mock。
- device 为 `cuda`。
- `chickenrice-v2` 已安装并可加载。
- `/api/translate-audio` 返回 Stable API v1 结构。
- `source_language=ja`、`target_language=zh-CN`。
- 文本与 segments 非空，时间轴合法。
- 性能指标公式一致。
- UTF-8 JSON / SRT 产物可读取。

详细说明见 [`docs/phase3-translation-quality.md`](docs/phase3-translation-quality.md)。该文档名称为历史遗留；当前 Phase 3 不再要求人工翻译质量评分。

## Health Check

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
| POST | `/v1/transcriptions` | 创建异步转录任务，返回 `202` |
| GET | `/v1/tasks/{task_id}` | 查询内存任务状态和结果 |
| POST | `/v1/translations` | 返回任务翻译 Contract |

这些接口保持兼容。新的稳定客户端应优先使用 `/api/*`。

## 测试

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

基础测试覆盖健康检查、API Contract、统一错误结构、GPU-only 设备策略、OpenAPI 路径和应用生命周期。GitHub Actions 使用 Windows smoke test 做持续回归。

真实模型 checker：

```powershell
.venv\Scripts\python scripts\phase2_check.py --file "C:\ASMR\sample.wav"
.venv\Scripts\python scripts\phase3_check.py --file "C:\ASMR\sample.wav"
```

## 下一阶段

核心推理 MVP 已经成立。下一阶段优先从“能在开发环境运行”推进到“能稳定被其他本机软件长期调用”：

1. **Windows Runtime / GPU Preflight**：自动发现并验证 CUDA、cuBLAS、cuDNN DLL 与可用 NVIDIA GPU，提供明确错误信息。
2. **Windows 启动与分发**：减少手工 Python 环境配置，整理一键启动、依赖安装和正式运行目录。
3. **服务运行稳定性**：完善启动/关闭、模型切换、并发忙状态、异常恢复与日志诊断。
4. **真实客户端接入**：用至少一个实际调用方完成端到端集成，验证 Stable API v1 足够支撑业务。
5. **版本与发布基线**：定义第一个可供其他软件依赖的版本和发布验收标准。

不在近期范围内：公网服务、多用户鉴权、CPU fallback、复杂任务队列、翻译质量自动评分。