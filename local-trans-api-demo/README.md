# Local Trans API Demo

Windows 专用、本机运行的转录 / 语音翻译 API Demo。

当前处于 **Phase 0（Mock 模式）**：不依赖 CUDA、NVIDIA GPU、真实模型或 Hugging Face，
仅验证 API、Web UI、字幕数据结构与 JSON / SRT 输出链路是否成立。

```text
Web UI → FastAPI → InferenceService → Engine Interface → MockEngine
         （Phase 1 起替换为 FasterWhisperEngine，API / Schema / 前端均不改动）
```

## 快速开始（Windows）

```powershell
setup.bat
run.bat
```

打开：

- Web UI：<http://127.0.0.1:8765/>
- API Docs：<http://127.0.0.1:8765/docs>

`setup.bat` 只安装 `requirements.txt`（FastAPI / Uvicorn / Pydantic）。Mock 模式需要 Python
3.11+（读取 `config.toml` 用到标准库 `tomllib`），推荐 3.12。

非 Windows 环境下等价命令：

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

## API

Base URL：`http://127.0.0.1:8765`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活检查 |
| GET | `/api/status` | 引擎、忙闲状态、已加载模型 |
| GET | `/api/models` | 模型列表（Mock 模式 `installed` 恒为 `true`） |
| POST | `/api/models/load` | 加载模型，body `{"model": "chickenrice-v2"}` |
| POST | `/api/models/unload` | 卸载模型 |
| POST | `/api/transcribe` | 日语音频转写，profile `ja-transcribe` |
| POST | `/api/translate-audio` | 日语 → 中文语音翻译，profile `ja-zh` |

推理请求：

```json
{ "path": "D:\\ASMR\\test.flac" }
```

## Mock 行为

- 不读取媒体文件，也不检查文件是否存在；只要求 `path` 非空（空字符串返回 `422`）。
  因此 macOS / Linux / CI 环境可以完整跑通 Demo。
- 固定 `1.5 s` 推理延迟、`0.3 s` 加载延迟，用于验证 Loading / Processing / Busy 状态；
  数值不随机，保证测试稳定。
- 只允许一个推理任务：占用期间第二个请求返回 `409 {"detail": "Inference engine is busy"}`。
- 转录固定返回日文字幕，翻译固定返回中文字幕，字段结构与真实模型阶段完全一致。

## 输出文件

每次推理都会真实写入 `output/`，文件名取自路径最后一段（Windows 反斜杠路径同样可用）：

```text
D:\ASMR\RJ123\track01.flac  →  output/track01.transcribe.json / .srt   （转录）
D:\ASMR\test.flac           →  output/test.zh.json / .srt              （翻译）
```

## 脚本

不经 HTTP，直接在进程内复用 `InferenceService`：

```powershell
.venv\Scripts\python scripts\test_inference.py --profile ja-transcribe --file "D:\ASMR\test.flac"
```

Phase 2 才需要的模型下载（默认不安装 AI 依赖）：

```powershell
.venv\Scripts\pip install -r requirements-ai.txt
.venv\Scripts\python scripts\download_models.py
```

## 切换到真实引擎

Phase 1 起实现 `app/engines/faster_whisper_engine.py`，随后只改配置：

```toml
[inference]
engine = "faster-whisper"
```

`MockEngine` 会长期保留，用于前端开发、API 联调、CI 与无 NVIDIA GPU 的开发环境。

## 安全限制

服务固定监听 `127.0.0.1`。这是一个接受本地文件路径的 API，
**不得直接暴露到局域网 / 公网**（Local path API must not be exposed directly to LAN/WAN）。

## 目录结构

```text
app/api/        路由（health / models / inference）
app/core/       配置、应用状态、统一错误类型
app/engines/    Engine 接口 + MockEngine（+ FasterWhisperEngine 骨架）
app/services/   InferenceService：Profile 解析、模型切换、并发锁、写输出
app/schemas/    请求 / 响应模型
app/utils/      SRT 生成、JSON / SRT 落盘
static/         原生 HTML / CSS / JS 前端
models/ output/ samples/ scripts/
```

## 已知限制

- 真实模型阶段未实现：`FasterWhisperEngine` 目前会在构造时抛出明确错误。
- 后端 `realtime_factor` 由 `processing_time / duration` 计算（四舍五入到 4 位），
  翻译样例因此为 `0.0152`，与设计文档示例中的 `0.0151` 有末位差异。
- 状态展示每 2 秒轮询一次，未使用 WebSocket。
