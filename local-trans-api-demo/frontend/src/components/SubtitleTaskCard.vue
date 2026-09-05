<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../types";

const props = defineProps<{ task: SubtitleTask }>();

const PREVIEW_LINES = 6;

const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  loading_model: "加载模型",
  processing: "处理音频",
  writing_output: "写入字幕",
  completed: "已完成",
  failed: "失败",
};

const STATUS_LABELS: Record<SubtitleTask["status"], string> = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
};

const STATUS_CHIP_CLASS: Record<SubtitleTask["status"], string> = {
  queued: "chip-warning",
  running: "chip-accent",
  succeeded: "chip-success",
  failed: "chip-danger",
};

const expanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const modeLabel = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日语翻译成中文",
);

const statusLabel = computed(
  () => STATUS_LABELS[props.task.status] ?? props.task.status,
);

const statusChipClass = computed(
  () => STATUS_CHIP_CLASS[props.task.status] ?? "chip",
);

const stageLabel = computed(() => {
  if (props.task.status === "succeeded") return "已完成";
  if (props.task.status === "failed") return "失败";
  return STAGE_LABELS[props.task.stage] ?? props.task.stage;
});

const resultText = computed(() => props.task.result?.text ?? "");

const textLines = computed(() => resultText.value.split("\n"));

const hasMoreLines = computed(() => textLines.value.length > PREVIEW_LINES);

const visibleText = computed(() =>
  expanded.value || !hasMoreLines.value
    ? resultText.value
    : textLines.value.slice(0, PREVIEW_LINES).join("\n"),
);

const hiddenLineCount = computed(() =>
  Math.max(0, textLines.value.length - PREVIEW_LINES),
);

function formatLocalTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)} 秒`;
}

async function copyText(): Promise<void> {
  const text = resultText.value;
  if (!text || isCopying.value) return;

  isCopying.value = true;
  copyMessage.value = "";

  try {
    if (!navigator.clipboard?.writeText) {
      copyMessage.value = "当前浏览器不支持复制，请展开后手动选择文本。";
      return;
    }

    await navigator.clipboard.writeText(text);
    copyMessage.value = "已复制";
  } catch {
    copyMessage.value = "复制失败，请展开后手动选择文本。";
  } finally {
    isCopying.value = false;
  }
}
</script>

<template>
  <li class="task">
    <div class="task-head">
      <strong class="task-name break-anywhere">{{ task.original_name }}</strong>
      <span class="chip" :class="statusChipClass">状态 {{ statusLabel }}</span>
      <span v-if="task.mock" class="chip chip-warning">模拟结果</span>
    </div>

    <p class="task-meta">
      {{ modeLabel }} · 创建时间 {{ formatLocalTime(task.created_at) }}（本地时间）
    </p>

    <p class="task-stage text-hint">当前阶段：{{ stageLabel }}</p>

    <p v-if="task.error" role="alert" class="message-alert">
      错误 {{ task.error.code }}：{{ task.error.detail }}
    </p>

    <template v-else-if="task.status === 'succeeded'">
      <p
        v-if="task.result && !task.result.text"
        class="text-hint"
      >
        未识别到语音，没有可复制的字幕文本。
      </p>

      <template v-if="task.result">
        <pre v-if="task.result.text" class="preview break-anywhere">{{ visibleText }}</pre>

        <div class="task-actions">
          <button
            v-if="hasMoreLines"
            type="button"
            class="button-secondary"
            @click="expanded = !expanded"
          >
            {{ expanded ? "收起" : `展开全文（还有 ${hiddenLineCount} 行）` }}
          </button>

          <button
            type="button"
            class="button-secondary"
            :disabled="!task.result.text || isCopying"
            @click="copyText"
          >
            复制文本
          </button>

          <a
            v-if="task.downloads"
            class="button-secondary link-button"
            :href="task.downloads.srt"
            download
            >下载 SRT</a
          >
          <a
            v-if="task.downloads"
            class="button-secondary link-button"
            :href="task.downloads.lrc"
            download
            >下载 LRC</a
          >
        </div>

        <p class="task-metrics text-hint">
          音频时长 {{ formatSeconds(task.result.duration) }} · 处理耗时
          {{ formatSeconds(task.result.processing_time) }}
        </p>

        <p v-if="copyMessage" role="status" class="message-status">
          {{ copyMessage }}
        </p>
      </template>
    </template>
  </li>
</template>

<style scoped>
.task {
  list-style: none;
  padding: 16px 0;
  border-top: 1px solid var(--border);
}

.task:first-child {
  border-top: 0;
  padding-top: 0;
}

.task-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-name {
  font-size: 14px;
}

.task-meta,
.task-stage {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.preview {
  margin: 10px 0 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 20rem;
  overflow: auto;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.link-button {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.task-metrics {
  margin-top: 8px;
}
</style>
