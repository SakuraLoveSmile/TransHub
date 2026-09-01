# Phase 3 ChickenRice 日语→中文人工质量验收

Phase 3 固定当前已经可用的 ChickenRice v2 CUDA 翻译链路，不调整推理参数、模型或 API。自动 checker 只检查请求是否真实走 CUDA、响应结构、时间轴、性能指标以及 JSON/SRT 产物；翻译是否“实际可用”必须由人工观看字幕并结合音频判断。

## 验收前提

在 Windows + NVIDIA CUDA 环境启动真实引擎服务，并确认没有使用 Mock Engine。每个样本使用独立文件名，避免后一次结果覆盖前一次的 `.zh.json` 和 `.zh.srt`。

```powershell
cd C:\User\File\Code\TransHub\local-trans-api-demo
.venv\Scripts\python scripts\phase3_check.py --file "C:\ASMR\sample-a-dialogue.wav"
.venv\Scripts\python scripts\phase3_check.py --file "C:\ASMR\sample-b-whisper.wav"
.venv\Scripts\python scripts\phase3_check.py --file "C:\ASMR\sample-c-binaural.wav"
```

每次运行都应得到 `0 check(s) failed`，并在服务输出目录生成与输入文件同名的：

```text
<sample>.zh.json
<sample>.zh.srt
```

如果模型未安装，先执行 checker 输出的安装命令：

```powershell
.venv\Scripts\python scripts\download_models.py --model chickenrice-v2
```

## 三类真实样本

| 样本 | 内容要求 | 实际文件 | Checker 结果 | 人工结论 |
| --- | --- | --- | --- | --- |
| A | 普通对话，敬语较多 | `sample-a-dialogue.*` | 待填写 | 待填写 |
| B | 低声、耳语、气声 | `sample-b-whisper.*` | 待填写 | 待填写 |
| C | 音效较多、停顿较长、双耳 ASMR | `sample-c-binaural.*` | 待填写 | 待填写 |

实际验收时将“实际文件”替换为真实样本的完整路径，并记录运行日期、输入时长、输出文件名和 checker 终端结果。不要用 Mock 输出或预先存在的旧输出代替本次真实请求。

## 人工检查表

对每个样本打开对应的 SRT，结合原始音频逐段检查：

- [ ] 中文整体能够理解
- [ ] 没有大面积漏译
- [ ] 没有连续重复或明显幻觉
- [ ] 敬语和语气大致合理
- [ ] 时间轴没有明显漂移
- [ ] SRT 可以直接观看

允许少量语句不自然、个别错词、ASMR 拟声词翻译不完美以及标点不理想。Phase 3 的目标是实际可用，不是文学级翻译，也不设置 BLEU、COMET、中文比例或 LLM 自动评分阈值。

## 结果记录

### Sample A

- 文件：
- Checker：`0 check(s) failed` / 失败项：
- JSON：
- SRT：
- 人工备注：
- 结论：可用 / 不可用

### Sample B

- 文件：
- Checker：`0 check(s) failed` / 失败项：
- JSON：
- SRT：
- 人工备注：
- 结论：可用 / 不可用

### Sample C

- 文件：
- Checker：`0 check(s) failed` / 失败项：
- JSON：
- SRT：
- 人工备注：
- 结论：可用 / 不可用

## Done 标准

Phase 3 只有在以下条件同时满足时才标记 Done：

1. 三个样本均为真实日语 ASMR 音频，其中至少覆盖上述三类内容。
2. 每个样本的 `phase3_check.py` 均为 `0 check(s) failed`。
3. 三个样本的 JSON 和 SRT 都能读取，SRT 能直接观看。
4. 三个样本的人工检查表全部完成，且没有灾难性漏译、重复、幻觉或时间轴漂移。
5. 人工结论达到“可用”。
