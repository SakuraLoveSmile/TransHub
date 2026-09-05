<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../types";

const props = defineProps<{ task: SubtitleTask }>();

const isExpanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const subtitleText = computed(() => props.task.result?.text ?? "");
const hasText = computed(() => subtitleText.value.trim().length > 0);
const hasLongText = computed(() => {
  const lines = subtitleText.value.split(/\r?\n/);
  return lines.length > 6 || subtitleText.value.length > 360;
});

function modeLabel(task: SubtitleTask): string {
  return task.mode === "transcribe" ? "日语转录" : "日语翻译成中文";
}

function statusLabel(task: SubtitleTask): string {
  if (task.status === "queued") return "排队中";
  if (task.status === "running") return "处理中";
  if (task.status === "succeeded") return "已完成";
  return "失败";
}

function stageLabel(task: SubtitleTask): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    loading_model: "正在加载模型",
    processing: "正在处理音频",
    writing_output: "正在写入字幕",
    completed: "字幕已生成",
    failed: "处理失败",
  };
  return labels[task.stage] ?? (task.stage || "未知");
}

function formatLocalTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  try {
    return `${new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)} · 本地时间`;
  } catch {
    return `${date.toLocaleString()} · 本地时间`;
  }
}

function formatSeconds(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return "—";
  }
  return `${value.toFixed(1)} 秒`;
}

async function copyText() {
  const text = props.task.result?.text;
  if (!text || !hasText.value || isCopying.value) return;

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
  <article class="task-card" :data-status="task.status">
    <header class="task-card-header">
      <div class="task-card-title">
        <h3 class="file-name">{{ task.original_name }}</h3>
        <div class="task-meta">
          <span>{{ modeLabel(task) }}</span>
          <span>{{ formatLocalTime(task.created_at) }}</span>
          <span v-if="task.mock" class="mock-badge">Mock 环境</span>
        </div>
      </div>
      <span class="task-status" :data-status="task.status">
        {{ statusLabel(task) }}
      </span>
    </header>

    <p class="task-stage">
      当前阶段：<strong>{{ stageLabel(task) }}</strong>
    </p>

    <template v-if="task.status === 'succeeded' && task.result">
      <div class="result-metrics" aria-label="处理结果信息">
        <span>音频时长 {{ formatSeconds(task.result.duration) }}</span>
        <span>处理耗时 {{ formatSeconds(task.result.processing_time) }}</span>
      </div>

      <div
        v-if="hasText"
        class="subtitle-preview"
        :class="{ 'is-collapsed': hasLongText && !isExpanded }"
      >
        <p>{{ subtitleText }}</p>
      </div>
      <p v-else class="empty-result">
        未识别到语音，字幕文本为空；复制文本暂不可用。
      </p>

      <button
        v-if="hasText && hasLongText"
        class="expand-button"
        type="button"
        :aria-expanded="isExpanded"
        @click="isExpanded = !isExpanded"
      >
        {{ isExpanded ? "收起全文" : "展开全文" }}
      </button>

      <div v-if="task.downloads" class="task-actions">
        <button
          type="button"
          :disabled="!hasText || isCopying"
          @click="void copyText()"
        >
          {{ isCopying ? "复制中…" : "复制文本" }}
        </button>
        <a
          class="button-secondary"
          :href="task.downloads.srt"
          download
        >
          下载 SRT
        </a>
        <a
          class="button-secondary"
          :href="task.downloads.lrc"
          download
        >
          下载 LRC
        </a>
      </div>
      <p v-if="copyMessage" class="copy-message" role="status">
        {{ copyMessage }}
      </p>
    </template>
    <p v-else-if="task.status === 'succeeded'" class="empty-result">
      字幕结果暂时不可用，无法读取到字幕文本。
    </p>

    <p v-if="task.error" class="card-error" role="alert">
      {{ task.error.code }}：{{ task.error.detail }}
    </p>
  </article>
</template>
