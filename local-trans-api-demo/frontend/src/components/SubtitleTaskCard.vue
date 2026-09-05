<template>
  <li class="task-card">
    <div class="task-head">
      <strong class="task-name">{{ task.original_name }}</strong>
      <span class="mode">{{ modeLabel }}</span>
      <span class="time">{{ localTime }}</span>
      <span v-if="task.mock" class="mock-badge">模拟</span>
      <span class="stage">{{ stageLabel }}</span>
    </div>

    <p v-if="task.error" role="alert" class="error">
      {{ task.error.code }}：{{ task.error.detail }}
      <span v-if="errorHint" class="error-hint">{{ errorHint }}</span>
    </p>
    <p
      v-else-if="task.status === 'succeeded' && !hasText"
      class="hint"
    >
      未识别到语音（空结果）。
    </p>
    <template v-else-if="hasText">
      <p class="result-text" :class="{ collapsed: !expanded }">
        {{ resultText }}
      </p>
      <div class="text-actions">
        <button type="button" class="ghost-button" @click="toggle">
          {{ expanded ? "收起" : "展开全文" }}
        </button>
        <button
          type="button"
          class="ghost-button"
          :disabled="!hasText"
          @click="copyText"
        >
          复制文本
        </button>
        <span v-if="copyFeedback" role="status" class="copy-feedback">{{
          copyFeedback
        }}</span>
      </div>
    </template>

    <p v-if="timingText" class="timing">{{ timingText }}</p>

    <div
      v-if="task.downloads && task.status === 'succeeded'"
      class="downloads"
    >
      <a :href="task.downloads.srt" download>下载 SRT</a>
      <a :href="task.downloads.lrc" download>下载 LRC</a>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../types";

const props = defineProps<{
  task: SubtitleTask;
}>();

// 卡片内部只保留展示态（展开／复制反馈），任务数据本身完全由父组件传入。
const expanded = ref(false);
const copyFeedback = ref("");

const ERROR_HINTS: Record<string, string> = {
  QUEUE_FULL: "队列已满，请稍后重试，无需重复提交。",
  ENGINE_BUSY: "引擎正忙，请等待当前任务完成后再试。",
  MODEL_NOT_INSTALLED: "模型尚未安装，请先在模型管理中下载。",
  MODEL_LOAD_FAILED: "模型加载失败，可重试或更换模型。",
  INFERENCE_FAILED: "推理失败，可重试；持续失败请检查服务日志。",
  TRANSCRIPTION_FAILED: "转写失败，可重试；持续失败请检查服务日志。",
  EMPTY_FILE: "文件为空，请重新选择有效的音视频文件。",
  UNSUPPORTED_FILE: "文件类型不受支持，请更换音视频文件。",
  FILE_TOO_LARGE: "文件过大，请压缩或截取后再提交。",
  OUTPUT_WRITE_FAILED: "字幕写入失败，可重试。",
  TASK_NOT_FOUND: "任务不存在，可能已过期被清理。",
  RESULT_NOT_READY: "结果尚未就绪，等待轮询自动更新即可。",
  RESULT_MISSING: "结果文件已过期或被清理。",
  SERVICE_RESTARTED: "服务重启导致中断，请重新提交。",
  INTERNAL_ERROR: "服务内部错误，可稍后重试。",
  INVALID_REQUEST: "请求参数非法，请检查文件与处理方式。",
};

const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  loading_model: "加载模型",
  processing: "处理中",
  writing_output: "写入字幕",
  completed: "已完成",
  failed: "失败",
};

const modeLabel = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日译中",
);

const stageLabel = computed(() => {
  if (props.task.status === "succeeded") return "已完成";
  if (props.task.status === "failed") return "失败";
  return STAGE_LABELS[props.task.stage] ?? props.task.stage;
});

const localTime = computed(() => {
  const raw = props.task.created_at;
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
});

const resultText = computed(() => props.task.result?.text ?? "");
const hasText = computed(() => resultText.value.length > 0);

const errorHint = computed(() => {
  const code = props.task.error?.code;
  if (!code) return "";
  return ERROR_HINTS[code] ?? "";
});

const timingText = computed(() => {
  const result = props.task.result;
  if (!result) return "";
  const parts: string[] = [];
  if (Number.isFinite(result.duration) && result.duration > 0) {
    parts.push(`音频时长 ${result.duration.toFixed(1)}s`);
  }
  if (Number.isFinite(result.processing_time) && result.processing_time > 0) {
    parts.push(`耗时 ${result.processing_time.toFixed(1)}s`);
  }
  return parts.join("，");
});

function toggle(): void {
  expanded.value = !expanded.value;
}

async function copyText(): Promise<void> {
  if (!hasText.value) return;
  copyFeedback.value = "";
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      throw new Error("clipboard unavailable");
    }
    await clipboard.writeText(resultText.value);
    copyFeedback.value = "已复制到剪贴板。";
  } catch {
    // 无剪贴板 API（非安全上下文／旧浏览器／权限拒绝）时给手动复制兜底。
    copyFeedback.value = "复制失败，浏览器不支持剪贴板，请手动复制。";
  }
}
</script>

<style scoped>
.task-card {
  border-top: 1px solid var(--border, #eee);
  padding: 8px 0;
  list-style: none;
}
.task-head {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.task-name {
  overflow-wrap: anywhere;
  word-break: break-all;
  min-width: 0;
}
.mode,
.stage,
.time,
.mock-badge {
  font-size: 12px;
  border-radius: 4px;
  padding: 2px 6px;
}
.mode,
.stage {
  background: var(--chip-bg, #f0f0f0);
  color: var(--text, #222);
}
.time {
  color: var(--muted, #666);
}
.mock-badge {
  background: var(--mock-bg, #fff3cd);
  border: 1px solid var(--mock-border, #e6a800);
  color: var(--text, #222);
}
.error {
  color: var(--error, #a00);
}
.error-hint {
  display: block;
  font-size: 12px;
}
.hint {
  color: var(--muted, #666);
  font-size: 13px;
}
.result-text {
  font-size: 14px;
  color: var(--text, #333);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 8px 0;
}
.result-text.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.text-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ghost-button {
  cursor: pointer;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  padding: 4px 12px;
  background: var(--button-bg, #f4f4f5);
  color: var(--text, #222);
  font-size: 13px;
}
.ghost-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.ghost-button:focus-visible {
  outline: 2px solid var(--accent, #4c8dff);
  outline-offset: 2px;
}
.copy-feedback {
  font-size: 13px;
  color: var(--success, #0a5);
}
.timing {
  font-size: 12px;
  color: var(--muted, #666);
  margin: 6px 0 0;
}
.downloads {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
</style>
