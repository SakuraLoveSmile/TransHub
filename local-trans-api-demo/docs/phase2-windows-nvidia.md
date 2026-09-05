# Phase 2 Windows + NVIDIA 验收指南

## 目标

验证 TransferHub 从 Mock Engine 切换到真实 `faster-whisper` Engine 后，可以完成：

- Windows 环境启动
- 模型加载
- NVIDIA CUDA 推理
- 真实音频转录
- API Schema 与 Mock 保持一致

TransferHub 的真实推理链路为 NVIDIA GPU / CUDA-only，不提供 CPU 推理降级。

本阶段不测试翻译质量。ChickenRice 日语 → 中文质量属于后续 Phase 3。

---

## 前置条件

目标机器：

- Windows 10/11
- NVIDIA GPU
- 已安装 NVIDIA 驱动
- CUDA 12.x 运行环境可用
- cuDNN 9 可用
- Python 环境可运行
- 有足够磁盘空间

建议准备：

- 一段真实日语音频，例如：

```text
D:\ASMR\test.flac
```

---

## 安装 AI 依赖

进入项目目录：

```powershell
cd local-trans-api-demo
```

安装 AI 依赖（或使用一键安装脚本 `.\setup-real.bat`）：

```powershell
.\setup-real.bat
```

等价手动步骤：

```powershell
.venv\Scripts\pip install -r requirements-ai.txt
```

包含：

- faster-whisper
- ctranslate2
- huggingface-hub
- nvidia-ml-py

---

## 下载模型

Mock 模式不需要模型。

Phase 2 使用真实模型：

```powershell
.venv\Scripts\python scripts\download_models.py --model whisper-ja-1.5b
```

模型目录：

```text
models/
└── whisper-ja-1.5b/
```

安装判定要求以下文件存在：

```text
model.bin
config.json
tokenizer.json
```

不完整下载不会被认为安装成功。

---

## 配置真实 Engine

不要修改默认 CI 配置。

复制配置：

```powershell
copy config.real.example.toml config.real.toml
```

或者直接使用一键启动脚本（推荐）：

```powershell
.\run-real.bat
```

`run-real.bat` 会自动：
1. 检查 `.venv`
2. 若 `config.real.toml` 不存在，自动从 `config.real.example.toml` 复制
3. 设置 `TRANS_HUB_CONFIG`
4. 运行 `scripts\preflight.py` 自动化检测 GPU、驱动与 CUDA/cuDNN DLL
5. 检查通过后启动服务；若缺少依赖或 DLL，立即 fail-fast 拒绝启动并打印可操作的修复指引

手动启动流程：

```powershell
$env:TRANS_HUB_CONFIG="$PWD\config.real.toml"
run.bat
```

---

## CUDA 验收

执行：

```powershell
.venv\Scripts\python scripts\phase2_check.py `
  --file "D:\ASMR\test.flac" `
  --expect-device cuda
```

通过标准：

- `/api/status` 返回：

```json
{
  "engine": "faster-whisper",
  "mock": false,
  "device": "cuda"
}
```

- 模型加载成功
- 返回真实 segments
- 时间轴有效
- 输出 JSON/SRT 生成
- API Schema 与 Mock 一致

---

## 验收输出

成功后记录：

```text
--- Phase 2 summary ---
device
load_seconds
duration
processing_time
speed
segments
first_text

0 check(s) failed
```

建议保存：

- GPU 型号
- CUDA 版本
- 模型加载时间
- 音频时长
- 推理速度
- segments 数量

---

## 常见问题

### 模型未安装

执行：

```powershell
.venv\Scripts\python scripts\download_models.py --model whisper-ja-1.5b
```

### CUDA 不可用

检查：

- NVIDIA 驱动
- CUDA 12.x
- cuDNN 9
- ctranslate2 CUDA 支持
- `/api/status` 中 device 值

使用自动化 GPU Preflight CLI 检查（替代手工 `where.exe`）：

```powershell
.venv\Scripts\python scripts\preflight.py
```

CLI 会自动探测：
- NVIDIA GPU 型号与驱动版本（NVML）
- CUDA Runtime 与 ctranslate2 可用状态
- 关键 DLL 是否存在：`cublas64_12.dll`、`cublasLt64_12.dll`、`cudnn64_9.dll`（自动检查系统 PATH、CUDA_PATH、site-packages 与标准安装路径）
- 若有缺失，输出精准的修复指引与 PATH 提示

服务启动后，亦可在浏览器访问 `http://127.0.0.1:8765/diagnostics.html` 查看「GPU Preflight」面板。

如果 CUDA Runtime 不完整，应修复 GPU 环境后重新启动服务；TransferHub 不会自动降级到 CPU。

---

## 完成标准

Phase 2 完成需要：

- [ ] CUDA 验收通过
- [ ] API Schema 未变化
- [ ] Mock 与 FasterWhisper 输出结构一致
- [ ] 输出 JSON/SRT 正常
- [ ] 最终 `0 check(s) failed`

完成后再进入 Phase 3：

- ChickenRice 日语 → 中文翻译质量评估
- 字幕时间轴优化
- ASMR 场景优化
