# Phase 3 ChickenRice 日语→中文链路验收

Phase 3 用于固定当前已经可用的 ChickenRice v2 CUDA 翻译链路，不调整模型、推理参数或 Stable API Contract。

## 状态

**Phase 3 已完成。**

已完成的真实验收基线：

- Windows + NVIDIA CUDA 真机运行。
- `chickenrice-v2` 可加载。
- `POST /api/translate-audio` 已完成真实日语→中文翻译。
- 返回 `success=true`、`mock=false`、`profile=ja-zh`。
- `source_language=ja`、`target_language=zh-CN`。
- JSON / SRT 输出可正常读取。
- UTF-8 中文输出正常。
- 已记录真实 19 分钟级音频的性能基线。
- `scripts/phase3_check.py` 已落库，用于后续机器和版本的重复验证。

## 工程验收范围

Phase 3 checker 只检查工程链路：

- 服务可达且健康。
- 使用真实 `faster-whisper` engine，而非 Mock。
- device 为 `cuda`。
- `chickenrice-v2` 已安装并可以加载。
- `/api/translate-audio` 返回 Stable API v1 结构。
- 日语→简体中文语言字段正确。
- 翻译文本和 segments 非空。
- segments 时间范围和顺序合法。
- 文本与 segments 拼接结果一致。
- performance metrics 与稳定公式一致。
- JSON / SRT 产物存在并可按 UTF-8 读取。
- SRT block 数量与 segments 一致。

运行方式：

```powershell
cd C:\User\File\Code\TransHub\local-trans-api-demo
.venv\Scripts\python scripts\phase3_check.py --file "C:\ASMR\sample.wav"
```

预期结果：

```text
0 check(s) failed
```

如果模型尚未安装：

```powershell
.venv\Scripts\python scripts\download_models.py --model chickenrice-v2
```

## 翻译质量不属于 Done 门槛

TransHub 的职责是提供稳定的本机转录 / 翻译服务和统一 API，而不是建立模型质量评测体系。

因此以下内容不再作为 Phase 3 完成条件：

- 三类 ASMR 样本人工打分。
- BLEU / COMET 等翻译指标。
- LLM 自动评分。
- 对自然度、敬语、文学表达的强制评价。
- 固定中文比例阈值。

实际翻译质量由 `chickenrice-v2` 模型能力、输入音频和具体业务场景决定。后续如发现明确的工程问题，例如空输出、严重时间轴错误、重复段落、乱码或 Contract 破坏，应作为独立 Bug 处理，而不是重新打开 Phase 3 质量验收。

## Done 标准

Phase 3 的 Done 标准为：

1. ChickenRice v2 在 Windows + NVIDIA CUDA 真机可加载。
2. 真实日语音频可通过 `/api/translate-audio` 完成翻译。
3. Stable API v1 字段、语言信息、segments 和性能指标正常。
4. JSON / SRT 产物正常生成并可读取。
5. `phase3_check.py` 已进入仓库，后续可以重复执行工程验收。

以上条件已经满足，Phase 3 关闭。