# TransHub 客户端集成契约指南 (Stable API v1)

本文档面向希望接入 TransHub 的**本机真实调用方**（如 [AsmrDownloader](https://github.com/SakuraLoveSmile/AsmrDownloader) 的 Windows AI 字幕处理链路、本地脚本或第三方客户端），定义完整的集成契约、生命周期控制及调用最佳实践。

---

## 1. 定位与运行约束

- **网络边界**：TransHub 默认仅监听本机 `127.0.0.1:8765`，仅供单用户本机调用，严禁暴露至局域网或公网。
- **环境要求**：生产真实推理环境为 **Windows + NVIDIA GPU + CUDA-only**（通过 `run-real.bat` 启动），不提供 CPU fallback。
- **请求模式**：**同步单槽（Single-slot Synchronous）**。服务为单 GPU 独占设计，每次只处理一个推理任务。
- **接口定位说明**：
  - **`/api/*`**：**Stable API v1 正式接口**。生产客户端必须统一使用 `/api/*` 提供的同步能力。
  - **`/v1/*`**：历史遗留（Legacy / Mock）。内部对接 `MockTranscriptionProvider`，**不驱动真实推理引擎**，生产调用方切勿调用。

---

## 2. Readiness 判定顺序 (四步体检法)

客户端在向 TransHub 发起正式推理前，应按如下标准顺序依次检测四个端点，以断言服务与硬件完全就绪：

```text
[1. GET /health] ──(存活?)──> [2. GET /api/setup/preflight] ──(硬件/CUDA/DLL?)──>
                                                                         │
[4. GET /api/models] <──(模型就绪?)── [3. GET /api/status] <──(引擎闲置/CUDA?)──┘
```

| 步骤 | 端点 | 核心断言条件 | 异常应对建议 |
| :--- | :--- | :--- | :--- |
| **Step 1: 保活** | `GET /health` | HTTP 200，`status == "ok"`，`service == "transferhub"` | 若网络错误或非 200，说明 TransHub 未启动，需引导用户执行 `run-real.bat`。 |
| **Step 2: 硬件** | `GET /api/setup/preflight` | HTTP 200，`ok == true`，`gpu.devices` 非空，`cuda.runtime_ok == true`，`dlls.all_ok == true` | 若 `ok == false`，检查返回中的 `problems` 与 `hints`（如缺少 cuBLAS/cuDNN DLL 或驱动过旧）。 |
| **Step 3: 引擎** | `GET /api/status` | HTTP 200，`engine == "faster-whisper"`，`mock == false`，`device == "cuda"`，`status == "idle"` | 若 `mock == true`，说明服务以开发模式启动；若 `status == "running"`，说明当前有任务进行，需等待。 |
| **Step 4: 模型** | `GET /api/models` | HTTP 200，目标模型（如 `whisper-ja-1.5b`、`chickenrice-v2`）存在且 `installed == true` | 若 `installed == false`，需提示用户运行 `python scripts/download_models.py --model <id>` 下载。 |

### Readiness 检查 Python 示例

```python
import urllib.request
import json

def check_readiness(base_url="http://127.0.0.1:8765", required_model="whisper-ja-1.5b") -> bool:
    def get_json(path):
        req = urllib.request.Request(f"{base_url}{path}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    # 1. 存活检查
    status, health = get_json("/health")
    if status != 200 or health.get("status") != "ok":
        return False

    # 2. Preflight 检查
    status, preflight = get_json("/api/setup/preflight")
    if status != 200 or not preflight.get("ok"):
        return False

    # 3. 引擎与设备检查
    status, state = get_json("/api/status")
    if (status != 200 or 
        state.get("engine") != "faster-whisper" or 
        state.get("mock") is not False or 
        state.get("device") != "cuda"):
        return False

    # 4. 目标模型安装检查
    status, models_data = get_json("/api/models")
    models = {m["id"]: m for m in models_data.get("models", [])}
    if not models.get(required_model, {}).get("installed"):
        return False

    return True
```

---

## 3. 音频提交契约

TransHub 支持两种音频提交模式：

### 模式 A：本地文件上传（推荐，客户端无需与服务端共享路径约定）

无论调用方与 TransHub 运行在何种工作目录，调用方均可通过标准 HTTP `multipart/form-data` 上传音频：
1. **上传文件**：`POST /api/upload`，表单字段名为 `file`。
2. **获取绝对路径**：响应返回 `{ "path": "C:\\...\\uploads\\<uuid>-<name>.flac", "name": "..." }`。
3. **发起推理**：将返回的 `path` 作为参数传入转录或翻译接口。

### 模式 B：同机服务端已知绝对路径直接提交

若调用方能够确定所处理音频在服务端的绝对磁盘路径，可直接传参，跳过上传：
```json
POST /api/transcribe
Content-Type: application/json

{
  "path": "D:\\Audio\\Track01.flac"
}
```

### 支持的音频/视频格式
`.wav`, `.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.mp4`, `.mkv`, `.webm`。
上传非法格式将返回 HTTP 400 `{"code": "UNSUPPORTED_FILE", ...}`。

---

## 4. 结果消费模式与本地字幕构建

### 4.1 `InferenceResult` 契约结构

调用 `POST /api/transcribe` 或 `POST /api/translate-audio` 成功后返回统一的 `InferenceResult`（HTTP 200）：

```json
{
  "success": true,
  "mock": false,
  "profile": "ja-transcribe",
  "model": "whisper-ja-1.5b",
  "duration": 12.34,
  "processing_time": 1.23,
  "realtime_factor": 0.0997,
  "speed": 10.03,
  "text": "こんにちは、世界。",
  "language": "ja",
  "segments": [
    {
      "start": 0.0,
      "end": 2.45,
      "text": "こんにちは、"
    },
    {
      "start": 2.45,
      "end": 4.12,
      "text": "世界。"
    }
  ]
}
```
*注：音频翻译接口额外返回 `"source_language": "ja"` 与 `"target_language": "zh-CN"`。*

### 4.2 客户端本地构建 SRT / LRC

> [!IMPORTANT]
> **真实调用方的消费准则**：
> 响应体是**完全自足**的，包含完整的文本与分段毫秒时间戳（`start`, `end`, `text`）。
> **真实调用方应直接利用响应中的 `segments` 本地构建所需字幕格式（SRT、VTT 或 LRC）**，由客户端自由决定文件存放路径和命名，无需依赖服务端写盘。

#### 本地重建标准 SRT 的参考实现 (Python)

```python
def format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def generate_srt(segments: list[dict]) -> str:
    blocks = []
    for idx, seg in enumerate(segments, start=1):
        start_ts = format_srt_timestamp(seg["start"])
        end_ts = format_srt_timestamp(seg["end"])
        text = seg["text"].strip()
        blocks.append(f"{idx}\n{start_ts} --> {end_ts}\n{text}")
    return "\n\n".join(blocks) + "\n" if blocks else ""
```

### 4.3 关于 `/api/output/{name}` 的定位

- TransHub 服务端在推理完成后，会同时在本地 `output/` 目录写入一份备份（`{stem}.transcribe.srt`、`{stem}.zh.srt` 等）。
- `GET /api/output/{name}` 仅为自带 Web UI 预览与下载提供便利。
- 该接口实行严格的沙箱规则：只允许读取 `output/` 目录内以 `.json` 或 `.srt` 结尾的文件，非法文件名或目录逃逸将返回 `422 INVALID_PATH`，文件不存在返回 `404 OUTPUT_NOT_FOUND`。

---

## 5. 并发控制与超时策略

### 5.1 单槽同步与超时配置
TransHub 在底层采用了 `asyncio.Lock` 单槽互斥锁。转录与音频翻译均为**长时间同步请求**，在处理长音频（如几十兆乃至几十分钟的音频）时，HTTP 连接会持续阻塞直至推理全部结束。

- **超时配置**：客户端必须配置足够的 HTTP Client 超时时间。
- **推荐设置**：常规请求设置 `timeout = 900.0`（15 分钟）以上，或者根据音频文件时长动态估算超时时间（例如 `max(300, audio_seconds * 1.5)`）。

### 5.2 并发占线与 409 `ENGINE_BUSY` 退避重试

当 TransHub 正在执行推理或正在加载/卸载模型时，任何新的推理或模型加载请求将被**即刻拒绝**，并返回 HTTP 409：

```json
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "code": "ENGINE_BUSY",
  "detail": "Inference engine is busy"
}
```

客户端在捕获 `409 ENGINE_BUSY` 后，应使用**带随机抖动的指数退避算法（Exponential Backoff with Jitter）**进行重试：

```python
import time
import random
import urllib.request
import urllib.error
import json

def call_transcribe_with_retry(base_url: str, audio_path: str, max_attempts=10, timeout=900.0):
    url = f"{base_url}/api/transcribe"
    payload = json.dumps({"path": audio_path}).encode("utf-8")
    
    base_delay = 1.0
    max_delay = 10.0
    
    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 409:
                err_body = json.loads(err.read().decode("utf-8"))
                if err_body.get("code") == "ENGINE_BUSY":
                    if attempt == max_attempts:
                        raise RuntimeError("Engine remained busy after maximum retries.")
                    # 指数退避 + 抖动
                    delay = min(max_delay, base_delay * (1.8 ** (attempt - 1)))
                    jitter = random.uniform(0.1, 0.5)
                    time.sleep(delay + jitter)
                    continue
            raise  # 其他错误直接抛出
    raise TimeoutError("Exceeded max retry attempts.")
```

---

## 6. 统一错误码表 (Frozen Contract)

所有业务异常均返回标准 JSON 结构：
```json
{
  "code": "UPPER_SNAKE_CASE_CODE",
  "detail": "Human-readable description"
}
```

| HTTP 状态码 | 业务错误码 (`code`) | 触发场景 | 客户端应对建议 |
| :--- | :--- | :--- | :--- |
| **400** | `UNSUPPORTED_FILE` | 提交或上传了不支持的后缀（如 `.txt`, `.exe`） | 校验文件后缀是否在允许列表内。 |
| **404** | `UNKNOWN_PROFILE` | 指定了未知的 profile | 检查请求路径或配置（如 `/api/transcribe` 使用 `ja-transcribe`）。 |
| **404** | `UNKNOWN_MODEL` | 请求加载了目录中未定义的模型名 | 检查模型 ID 是否拼写正确。 |
| **404** | `MODEL_NOT_INSTALLED` | 请求使用的模型尚未下载到本地 | 提示用户先运行模型下载脚本。 |
| **404** | `OUTPUT_NOT_FOUND` | 请求读取的产物文件在 output 目录不存在 | 确认推理是否成功或产物名是否正确。 |
| **409** | `ENGINE_BUSY` | 引擎正在执行推理或模型加载/卸载 | 执行指数退避重试（见第 5 节）。 |
| **409** | `DOWNLOAD_BUSY` | 正在执行模型下载任务 | 等待当前下载完成后再发起。 |
| **422** | `INVALID_PATH` | 音频路径不存在，或产物名包含目录跳转字符 | 检查文件绝对路径是否正确，拒绝 `..` 等越权路径。 |
| **422** | *(Pydantic 验证错误)* | 请求体 JSON 缺失必填字段或类型错误 | 检查请求体格式（如缺少 `path`）。 |
| **500** | `INFERENCE_FAILED` | 推理执行过程中引擎抛出异常（如音频数据损坏） | 记录日志并检查待处理音频文件是否损坏。 |
| **500** | `INTERNAL_ERROR` | 服务端未捕获异常 | 提示用户查看服务端控制台日志。 |
| **503** | `MODEL_LOAD_FAILED` | 显存不足（OOM）或权重文件损坏加载失败 | 提示释放显存或重新下载模型权重。 |

---

## 7. 批处理与性能最佳实践

1. **按模型分类聚合批处理**：
   - 如果有一批音频需要转录，另一批需要翻译，建议**先连续处理全部转录任务（`whisper-ja-1.5b`），再连续处理全部翻译任务（`chickenrice-v2`）**。
   - 避免在“转录”与“翻译”之间交替切换，因为每次切换都需要执行显存卸载与新权重加载（通常耗时 2~5 秒）。
2. **显式模型预热（Warmup）**：
   - 在开始批量处理前，可主动调用一次 `POST /api/models/load {"model": "whisper-ja-1.5b"}`。
   - 这样第一个音频请求就不会包含首次冷启动加载的开销，避免首包延迟导致调用方意外超时。

---

## 8. AsmrDownloader 接入参考伪代码

```python
class TransHubClient:
    def __init__(self, base_url="http://127.0.0.1:8765"):
        self.base_url = base_url.rstrip("/")

    def ensure_ready(self, model="whisper-ja-1.5b"):
        if not check_readiness(self.base_url, required_model=model):
            raise RuntimeError("TransHub service is not ready or target model is missing.")

    def transcribe_file(self, local_audio_path: str) -> str:
        """上传本地音频 -> 调用转录 -> 生成本地 SRT 文件路径"""
        # 1. 上传文件到服务端 uploads/
        uploaded = self._upload_file(local_audio_path)
        server_path = uploaded["path"]

        # 2. 携带退避重试执行转录
        result = call_transcribe_with_retry(self.base_url, server_path)

        # 3. 消费 segments，在本地构建并保存 SRT 字幕
        srt_content = generate_srt(result["segments"])
        local_srt_path = Path(local_audio_path).with_suffix(".srt")
        local_srt_path.write_text(srt_content, encoding="utf-8")
        
        return str(local_srt_path)
```
