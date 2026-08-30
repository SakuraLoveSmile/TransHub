# Local Trans API Demo

Windows 专用、本机运行的转录 / 语音翻译 API Demo。

- **Phase 0（Mock）**已完成：不依赖 CUDA、真实模型或 Hugging Face，即可跑通 API、Web UI、
  字幕数据结构与 JSON / SRT 输出链路。
- **Phase 1（FasterWhisperEngine）**已实现：真实 CTranslate2 推理已在本机 CPU 上跑通
  （见「真实引擎」一节）。
- **Phase 2（`whisper-ja-1.5b` 真实转录）**代码与验收脚本已就绪：设备 / `compute_type`
  开关加上 `scripts/phase2_check.py`。3.1 GB 目标模型与 NVIDIA 分支未在本机执行，
  §48 需按「Phase 2 验收」在 Windows 真机打勾；日语与 ChickenRice 翻译质量属 Phase 3。

```text
Web UI → FastAPI → InferenceService → Engine Interface → MockEngine
                                                   └→ FasterWhisperEngine
```

切引擎只改 `[inference] engine` 一行（或另存一份配置用 `TRANS_HUB_CONFIG` 指过去），
API、Schema、前端与输出格式完全不变。

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
| GET | `/api/output/<name>` | 只读回 `output/` 里的 `<name>.json` / `.srt`，供验收页比对落盘结果 |

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

| 脚本 | 用途 | 依赖 |
| --- | --- | --- |
| `scripts/test_inference.py` | 不经 HTTP，在进程内复用 `InferenceService` 跑一段音频 | 当前配置指定的引擎 |
| `scripts/download_models.py` | 下载 CTranslate2 模型到 `models/<model_id>/` | `requirements-ai.txt` |
| `scripts/smoke_check.py` | 断言 §38 的 Phase 0 验收项（打 Mock 引擎的服务） | 标准库 |
| `scripts/phase2_check.py` | 断言 §48 的 Phase 2 验收项（真实引擎 + 真实音频） | 标准库 |

```powershell
.venv\Scripts\python scripts\test_inference.py --profile ja-transcribe --file "D:\ASMR\test.flac"
.venv\Scripts\python scripts\smoke_check.py
.venv\Scripts\python scripts\phase2_check.py --file "D:\ASMR\test.flac" --expect-device cuda
```

两个检查脚本逐条打印 `PASS` / `FAIL` 并在有失败时以非 0 退出，可以直接进 CI。

## 可视化验收（Web）

同样的验收做成了页面：<http://127.0.0.1:8765/diagnostics.html>（首页标题下有入口）。
选套件 → 填媒体路径 → Run，每条断言实时变成 pass / fail / inconclusive，行可展开看请求结果，
底部 Summary 给出 `engine / device / load_seconds / duration / processing_time / speed /
segments / first_text`，可一键复制。

- **Phase 0 · Mock**：15 条，覆盖端点、模型目录、load/unload、日/中固定字幕、
  `output/` 落盘与 JSON 一致、空路径 422、并发 409、页面可访问。
- **Phase 2 · Real**：15 条，把固定字幕换成真实断言——schema 字段集与 Mock 相同、段数 > 0、
  时间轴递增有效、`text` 等于分段拼接、指标符合公式，另加 device、模型未下载、
  文件不存在 422、非音频 400。

断言逻辑与 `smoke_check.py` / `phase2_check.py` 一致，两者并存：页面给人看，脚本给 CI 跑。
落盘相关的三条靠 `GET /api/output/<name>` 读回文件，浏览器自己看不到服务器磁盘。

device 只做**呈现**：页面显示当前 `cpu` / `cuda`，期望值不符时提示
「改 `[faster_whisper] device` 后重启 `run.bat`」，不提供运行时切换。
Stop 只取消浏览器请求，服务端会把当前推理跑完并继续占用唯一推理槽——页面在停用时和
运行前（`engine idle before the run`）都会明确提示这一点。

代码在 `static/diagnostics.html` 与 `static/diagnostics.js`，无框架，样式复用 `style.css`。

## CI（Windows 实测）

`setup.bat` 与 `run.bat` 只能在 Windows 上验证，因此由仓库根的
`.github/workflows/windows-smoke.yml` 在 `windows-latest` 上跑：`setup.bat` → 检查
`.venv\Scripts\python.exe` → 用 `run.bat` 起服务 → `scripts/smoke_check.py` 断言全部
端点、422、并发 409 以及 `output/` 里的 JSON / SRT 内容。push 到 `main` 且改动落在
`local-trans-api-demo/**` 时自动触发，也可手动 dispatch；日志与 `output/` 作为 artifact 上传。

注意起服务与断言必须写在同一个 step：Actions 会在 step 结束时回收该 step 派生的进程树，
分两个 step 写会让服务在下一步开始前就被杀掉。

## 真实引擎（faster-whisper）

AI 依赖与模型都是可选项，装完才谈得上真实推理：

```powershell
.venv\Scripts\pip install -r requirements-ai.txt
.venv\Scripts\python scripts\download_models.py
```

`setup.bat` 不会安装 AI 依赖，Mock 模式始终可以独立运行。

下载目标目录固定为 `models/<model_id>/`：

```text
models/
├── whisper-ja-1.5b/     ← TransWithAI/whisper-ja-1.5B-ct2
└── chickenrice-v2/      ← chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2
```

判断「已下载」的标准是 `model.bin` + `config.json` + `tokenizer.json` 三个文件齐全，
因此中断的半成品目录会被识别为未安装并重新下载，而不是被当成已完成。
`/api/models` 的 `installed` 用的就是同一个判断。

访问不了 huggingface.co 时可以走镜像，无需改代码：

```powershell
$env:HF_ENDPOINT = "https://hf-mirror.com"
```

切换到真实引擎只改一行配置：

```toml
[inference]
engine = "faster-whisper"
```

行为差异：

- 设备选择默认 `auto`：`ctranslate2.get_cuda_device_count() > 0` 时用 `cuda` + `float16`，
  否则退回 `cpu` + `int8`；实际取值出现在 `/api/status` 的 `device` 字段。想固定设备
  （例如在有 GPU 的机器上专测 CPU 回退）就加一节配置：

  ```toml
  [faster_whisper]
  device = "cpu"          # auto | cpu | cuda
  compute_type = "int8"   # default 时按设备自动取 float16 / int8，其余值直接交给 CTranslate2
  ```

  `device` 写错会在启动时直接报错，不会拖到第一次推理。
- 只从本地目录加载，推理过程不会触发任何下载（`HF_HUB_OFFLINE=1` 下已验证）。
- 只有真实引擎检查媒体文件：不存在或指向目录 → `422`，扩展名不支持 → `400`
  （支持 `wav flac mp3 m4a aac ogg opus mp4 mkv webm`），模型未下载 → `404`，
  加载失败 → `503`。Mock 模式仍然完全不看文件。
- 模型加载与推理跑在工作线程里，推理期间 `/api/status` 依旧毫秒级返回。

想用另一份配置启动而不改动仓库里的 `config.toml`：

```powershell
$env:TRANS_HUB_CONFIG = "D:\dev\config.real.toml"
```

`MockEngine` 会长期保留：前端开发、API 联调、CI 以及没有 NVIDIA GPU 的环境都用它，
不会因为真实模型接入成功而删除。

## Phase 2 验收（Windows + NVIDIA）

仓库里的 `config.toml` 固定保持 `engine = "mock"`（CI 与无 GPU 环境依赖它），真机验收不必
改动仓库文件：

```powershell
.venv\Scripts\pip install -r requirements-ai.txt
.venv\Scripts\python scripts\download_models.py --model whisper-ja-1.5b   # model.bin 约 3.1 GB
copy config.toml config.real.toml
notepad config.real.toml                       # engine = "faster-whisper"，按需加 [faster_whisper]
$env:TRANS_HUB_CONFIG = "$PWD\config.real.toml"
run.bat
```

直接改 `config.toml` 那一行也完全可以，只是别把 `faster-whisper` 提交回去。

必须跑两遍：GPU 一遍、强制 CPU 回退一遍。

```powershell
.venv\Scripts\python scripts\phase2_check.py --file "D:\ASMR\test.flac" --expect-device cuda
# 配置里写 device = "cpu" 重启后再跑一遍
.venv\Scripts\python scripts\phase2_check.py --file "D:\ASMR\test.flac" --expect-device cpu
```

全绿时末尾会给出实测数字（形状如下，数值以真机为准）：

```text
--- Phase 2 summary ---
device           cuda
load_seconds     ...
duration         ...
processing_time  ...
speed            ...
segments         ...
first_text       こんばんは。
0 check(s) failed
```

脚本断言与 §48 验收项的对应关系：

| 验收项 | 覆盖方式 |
| --- | --- |
| 模型加载成功 | `POST /api/models/load` 计时并断言 200 + `loaded_model` |
| NVIDIA GPU 可使用 | `--expect-device cuda` 对上 `/api/status` 的 `device` |
| CPU fallback 可用 | 配置固定 `device = "cpu"` 后 `--expect-device cpu` |
| 返回真实 segments | 段数 > 0、时间轴严格递增且不越界、`text` 与分段拼接一致 |
| Web UI 不需要修改 | 断言 `/` 与 `/docs` 可达；字幕内容仍需浏览器里看一眼 |
| API Schema 不需要修改 | 断言响应字段集合与 Mock 模式完全相同 |
| SRT 输出不需要修改 | 断言 `output/<stem>.transcribe.srt` 块数 == 段数且为标准时间戳 |
| 只改 config 就能切换 | 同一份代码、只换配置文件跑通上面全部 |

模型未下载时脚本会在 `installed` 断言处 ABORT 并提示先跑 `download_models.py`，退出码非 0；
没有真模型和真素材就不可能得到 PASS，这条脚本不会虚假通过。并发 409、422、400 也在断言之列，
但如果素材太短（推理不到 1 秒）会明确报 INCONCLUSIVE 而不是假装通过。

## 安全限制

服务固定监听 `127.0.0.1`。这是一个接受本地文件路径的 API，
**不得直接暴露到局域网 / 公网**（Local path API must not be exposed directly to LAN/WAN）。

`GET /api/output/<name>` 是唯一能读服务器文件的接口：只读、只接受
`output/` 目录下 `*.json` / `*.srt` 的裸文件名，含 `/`、`\`、`..` 或别的扩展名一律 422，
解析后仍会校验目标确实落在 `output/` 内。

## 目录结构

```text
app/api/        路由（health / models / inference / output）
app/core/       配置、应用状态、统一错误类型
app/engines/    Engine 接口 + MockEngine + FasterWhisperEngine
app/services/   InferenceService：Profile 解析、模型切换、并发锁、写输出
app/schemas/    请求 / 响应模型
app/utils/      SRT 生成、JSON / SRT 落盘
static/         原生前端：demo（index/app.js）+ 验收页（diagnostics）
models/ output/ samples/ scripts/
```

## 已知限制

- 真实推理只验证过 CPU 分支（`cpu` + `int8`）与替身模型 `Systran/faster-whisper-tiny`
  （留在 `models/faster-whisper-tiny/`，已 gitignore、可随时删除）：本机没有 NVIDIA 设备，
  `cuda` + `float16` 与两个目标模型（`whisper-ja-1.5b` 3.1 GB、`chickenrice-v2`）都没有
  执行过，所以日语转录与中文翻译质量目前没有任何结论。
- Phase 2 状态：设备开关与 `scripts/phase2_check.py` 已就绪，并已对着真实引擎 + 真实音频
  跑通全部断言（含三条反向用例，证明断言会真的失败）；§48 按上面 runbook 在真机打勾。
- 本机访问不了 huggingface.co，只能走 `hf-mirror.com`：`snapshot_download` 对部分文件会失败，
  需要镜像端点或逐个 `resolve/main` 补齐。`download_models.py` 本身的失败原因输出、
  半成品重下与完成即复用三条路径均已实测。
- 后端 `realtime_factor` 由 `processing_time / duration` 计算（四舍五入到 4 位），
  翻译样例因此为 `0.0152`，与设计文档示例中的 `0.0151` 有末位差异。
- 状态展示每 2 秒轮询一次，未使用 WebSocket。
- CI 只走过 `setup.bat` 的 `py -3.12` 引导分支；`py` 启动器缺失时的 `python` / `python3`
  回退分支未被覆盖（`python3` 在真实 Windows 上可能被 Microsoft Store 别名占位）。
- 「Copy Text」优先用 Clipboard API，失焦等情况下退回 `execCommand("copy")`；
  这条路径还需要一次真实前台窗口点击确认。
