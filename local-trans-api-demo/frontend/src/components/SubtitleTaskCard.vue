<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../types";

const props = defineProps<{ task: SubtitleTask }>();

const isExpanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const modeLabel = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日语翻译成中文",
);

const statusLabel = computed(() => {
  switch (props.task.status) {
    case "queued":
      return "排队中";
    case "running":
      return "处理中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    default:
      return props.task.status;
  }
});

const statusClass = computed(() => `badge--${props.task.status}`);

const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  loading_model: "加载模型",
  processing: "处理音频",
  writing_output: "写入字幕",
  completed: "已完成",
  failed: "失败",
};

const stageLabel = computed(() => {
  if (props.task.status === "succeeded") return "已完成";
  if (props.task.status === "failed") return "失败";
  return STAGE_LABELS[props.task.stage] ?? props.task.stage;
});

const resultText = computed(() => props.task.result?.text ?? "");

const hasResultText = computed(
  () => props.task.status === "succeeded" && resultText.value.length > 0,
);

// 字幕通常按行分隔；超过六行或较长时提供展开入口，配合 CSS 行夹避免溢出。
const needsExpand = computed(() => {
  const text = resultText.value;
  if (!text) return false;
  return text.split("\n").length > 6 || text.length > 200;
});

function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatSeconds(value: number | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)} 秒`;
}

async function copyText() {
  const text = props.task.result?.text;
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

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}
</script>

<template>
  <article class="task-card">
    <header class="task-card__head">
      <div class="task-card__title">
        <strong class="task-card__name">{{ task.original_name }}</strong>
        <span class="badge" :class="statusClass">{{ statusLabel }}</span>
        <span v-if="task.mock" class="badge badge--mock">模拟</span>
      </div>
      <p class="task-card__meta">
        {{ modeLabel }} · {{ formatLocalTime(task.created_at) }}（本地时间）
      </p>
      <p class="task-card__stage">当前阶段：{{ stageLabel }}</p>
    </header>

    <p v-if="task.error" role="alert" class="task-card__error">
      {{ task.error.code }}：{{ task.error.detail }}
    </p>

    <template v-else-if="task.status === 'succeeded'">
      <p v-if="!hasResultText" class="task-card__empty">
        未识别到语音（空结果）。
      </p>

      <template v-else>
        <p
          class="task-card__text"
          :class="{ 'task-card__text--clamped': !isExpanded }"
        >
          {{ resultText }}
        </p>

        <div class="task-card__actions">
          <button
            v-if="needsExpand"
            type="button"
            class="button-ghost"
            @click="toggleExpand"
          >
            {{ isExpanded ? "收起" : "展开全文" }}
          </button>

          <button
            type="button"
            class="button-ghost"
            :disabled="isCopying"
            @click="copyText"
          >
            复制文本
          </button>

          <a
            v-if="task.downloads"
            class="button-ghost"
            :href="task.downloads.srt"
            download
          >
            下载 SRT
          </a>
          <a
            v-if="task.downloads"
            class="button-ghost"
            :href="task.downloads.lrc"
            download
          >
            下载 LRC
          </a>
        </div>

        <p v-if="copyMessage" role="status" class="task-card__feedback">
          {{ copyMessage }}
        </p>

        <p class="task-card__metrics">
          音频时长 {{ formatSeconds(task.result?.duration) }} · 处理耗时
          {{ formatSeconds(task.result?.processing_time) }}
        </p>
      </template>
    </template>
  </article>
</template>

<style scoped>
.task-card {
  padding: 16px 0;
  border-top: 1px solid var(--border);
}

.task-card:first-child {
  border-top: 0;
  padding-top: 0;
}

.task-card__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-card__name {
  font-size: 15px;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.task-card__meta,
.task-card__stage {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.badge {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.badge--queued {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
}

.badge--running {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

.badge--succeeded {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
}

.badge--failed {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.badge--mock {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
}

.task-card__error {
  margin: 10px 0 0;
  color: var(--danger);
  font-size: 13px;
}

.task-card__empty {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.task-card__text {
  margin: 12px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}

.task-card__text--clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  line-clamp: 6;
  overflow: hidden;
}

.task-card__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.task-card__feedback {
  margin: 8px 0 0;
  color: var(--success);
  font-size: 13px;
}

.task-card__metrics {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.button-ghost {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}

.button-ghost:hover:not(:disabled) {
  background: var(--surface-hover);
}
</style>
