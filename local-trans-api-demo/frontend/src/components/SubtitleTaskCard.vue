<template>
  <article class="task-card">
    <header class="task-head">
      <strong class="task-name">{{ task.original_name }}</strong>
      <span class="badge" :class="statusBadgeClass">{{ statusLabel }}</span>
      <span v-if="task.mock" class="badge badge-warning">模拟数据</span>
    </header>

    <p class="task-meta">{{ modeLabel }} · {{ createdAtLabel }}（本地时间）</p>
    <p v-if="stageText" class="task-stage">当前阶段：{{ stageText }}</p>

    <p v-if="task.error" role="alert" class="alert-error">
      错误代码 {{ task.error.code }}：{{ task.error.detail }}
    </p>
    <template v-else-if="task.status === 'succeeded'">
      <p v-if="resultMeta" class="task-meta">{{ resultMeta }}</p>
      <p v-if="!hasText" class="hint">未识别到语音（空结果）。</p>
      <pre v-else class="subtitle-text">{{ displayText }}</pre>
    </template>

    <div class="card-actions">
      <button
        v-if="canExpand"
        type="button"
        class="button-small"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起全文" : "展开全文" }}
      </button>
      <button
        type="button"
        class="button-small"
        :disabled="!hasText || isCopying"
        @click="copyText"
      >
        {{ isCopying ? "正在复制…" : "复制文本" }}
      </button>
      <template v-if="task.downloads && task.status === 'succeeded'">
        <a class="button-small" :href="task.downloads.srt" download>下载 SRT</a>
        <a class="button-small" :href="task.downloads.lrc" download>下载 LRC</a>
      </template>
    </div>

    <p
      v-if="copyMessage"
      role="status"
      class="copy-status"
      :class="{ 'copy-status-error': !copySucceeded }"
    >
      {{ copyMessage }}
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../api";

const props = defineProps<{ task: SubtitleTask }>();

const expanded = ref(false);
const isCopying = ref(false);
const copyMessage = ref("");
const copySucceeded = ref(false);

const PREVIEW_LINES = 6;

const modeLabel = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日语翻译成中文",
);

const statusLabel = computed(() => {
  const labels: Record<SubtitleTask["status"], string> = {
    queued: "排队中",
    running: "处理中",
    succeeded: "已完成",
    failed: "失败",
  };
  return labels[props.task.status];
});

const statusBadgeClass = computed(() => {
  const classes: Record<SubtitleTask["status"], string> = {
    queued: "badge-warning",
    running: "badge-accent",
    succeeded: "badge-success",
    failed: "badge-danger",
  };
  return classes[props.task.status];
});

const stageText = computed(() => {
  const task = props.task;
  if (task.status === "succeeded" || task.status === "failed") return "";
  const stages: Record<string, string> = {
    queued: "排队中",
    loading_model: "加载模型",
    processing: "处理音频",
    writing_output: "写入字幕",
  };
  return stages[task.stage] ?? task.stage;
});

const hasText = computed(() => Boolean(props.task.result?.text));

const textLines = computed(() => (props.task.result?.text ?? "").split("\n"));

const canExpand = computed(
  () => hasText.value && textLines.value.length > PREVIEW_LINES,
);

const displayText = computed(() => {
  const text = props.task.result?.text ?? "";
  if (!text || expanded.value) return text;
  const lines = textLines.value;
  return lines.length > PREVIEW_LINES
    ? `${lines.slice(0, PREVIEW_LINES).join("\n")}…`
    : text;
});

const createdAtLabel = computed(() => formatDate(props.task.created_at));

const resultMeta = computed(() => {
  const result = props.task.result;
  if (!result) return "";
  return `音频时长 ${formatSeconds(result.duration)} · 处理耗时 ${formatSeconds(result.processing_time)}`;
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)} 秒`;
}

async function copyText() {
  const text = props.task.result?.text;
  if (!text || isCopying.value) return;

  isCopying.value = true;
  copyMessage.value = "";

  try {
    if (!navigator.clipboard?.writeText) {
      copySucceeded.value = false;
      copyMessage.value = "当前浏览器不支持复制，请展开后手动选择文本。";
      return;
    }

    await navigator.clipboard.writeText(text);
    copySucceeded.value = true;
    copyMessage.value = "已复制";
  } catch {
    copySucceeded.value = false;
    copyMessage.value = "复制失败，请展开后手动选择文本。";
  } finally {
    isCopying.value = false;
  }
}
</script>
