# TransHub

TransHub 是 Windows 本地运行的转录 / 语音翻译 API 中枢，为本机其他软件提供统一的 AI 音频处理入口。

## 当前阶段：Phase 3 完成，进入产品化阶段

当前核心 MVP 已完成真实模型链路验证，主页「打开 → 选一个本地音频文件 → 出字幕 → 下载 SRT」闭环可用：

当前核心 MVP 已完成真实模型链路验证：

- FastAPI + Uvicorn 本地服务可启动和退出。
- Stable API Contract v1 已冻结。
- Mock Engine 保留用于开发、测试和 CI。
- `FasterWhisperEngine` 已接入真实模型。
- `whisper-ja-1.5b` 已完成 Windows + NVIDIA CUDA 真机转录验收。
- `ChickenRice v2` 已完成 Windows + NVIDIA CUDA 日语→中文真实翻译链路验收。
- JSON / SRT 输出、segments 时间轴和性能指标已进入自动 checker。
- 主页「选本地文件」：浏览器 `POST /api/upload` 保存到本机 `uploads/`（`{uuid}-{原名}`）后再走 `/api/transcribe`，结果可预览 / 复制 / 下载 SRT。
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

`GET /api/setup/env`、`POST /api/setup/download`、`GET /api/setup/download`、`POST /api/upload` 和 `/diagnostics.html` 仅供本机设置与诊断，不属于 Stable API v1，不承诺长期兼容。`/api/upload` 是网页「选文件」的支撑端点。

## Phase 2：真实日语转录

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

`config.real.toml` 与 `config.toml` 的差异只有引擎开关：`engine = "faster-whisper"`、`[faster_whisper] device = "cuda"`、`compute_type = "float16"`；`config.real.toml` 保持本地不入库（已在 `.gitignore`），仓库只提交 `config.real.example.toml` 模板。正式真实推理为 **CUDA-only**，无 GPU / CUDA Runtime 时明确失败，不会自动降级到 CPU。

启动后 `GET /api/status` 应为 `engine=faster-whisper`、`mock=false`、`device=cuda`。Phase 2 已完成 Windows + NVIDIA CUDA 真机验收：真实 19 分钟级日语音频完成模型加载、转录、segments、JSON/SRT 与 API Contract 验证。完整验收步骤见 [`docs/phase2-windows-nvidia.md`](docs/phase2-windows-nvidia.md)，自动验收入口：

```text
python scripts\phase2_check.py --file "D:\ASMR\test.flac" --model whisper-ja-1.5b --language ja --expect-device cuda
```

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

## 深色工具台交付记录（feat/dark-workbench-plan-20260905）

本分支的深色字幕工作台（Vue 前端重构）由 **qoder 3.8 max xhigh** 完成，实测数据记录如下：

| 项目 | 数据 |
|---|---|
| 分支 / worktree | `feat/dark-workbench-plan-20260905` / `TransHub-dark-workbench-plan`（基于 `6351fb1`） |
| 完成日期 | 2026-09-05 |
| 完成时间 | 19:59 创建 worktree → 21:01 最终验证与报告；墙钟约 62 分钟（2 个 goal 轮，含轮次间隔） |
| 改动规模 | 暂存 22 文件 / +5957 行（含 lockfile 与配置拷贝）；其中前端源码+测试 17 文件 / +2957 行 |
| 自动化验证 | `npm run test` 50/50 通过；`npm run typecheck` 无错误；`npm run build` 成功；`git diff --check` 干净 |
| 浏览器验收 | 1440/1024/768/390 四视口无横向溢出；mock 全流程（选择→提交→结果→下载）；键盘可达；截图 5 张存于 `.acceptance-dark-workbench/` |
| Token 速度 | 运行时未暴露真实 token 用量（会话日志 token 字段均为 0），无可靠值，记为 N/A |
| 未验证项 | 真实 Windows + NVIDIA CUDA 推理；展开按钮浏览器未触发（单元测试覆盖）；下载落盘未在无头环境验证 |

状态：改动已暂存，**未提交、未推送**。