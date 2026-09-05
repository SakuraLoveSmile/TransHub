<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../api";

const props = defineProps<{ task: SubtitleTask }>();

const expanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const modeLabel = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日语翻译成中文",
);

const hasText = computed(() => Boolean(props.task.result?.text));

function stageLabel(): string {
  const stages: Record<string, string> = {
    queued: "排队中",
    loading_model: "正在加载模型",
    processing: "正在处理音频",
    writing_output: "正在生成字幕",
    completed: "已完成",
    failed: "失败",
  };
  if (props.task.status === "succeeded") return "已完成";
  if (props.task.status === "failed") return "失败";
  return stages[props.task.stage] ?? props.task.stage;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleString()}（本地时间）`;
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
  <li class="task-card">
    <div class="task-head">
      <strong class="file-name">{{ task.original_name }}</strong>
      <span class="badge">{{ modeLabel }}</span>
      <span v-if="task.mock" class="badge mock">模拟</span>
      <span class="badge" :class="task.status">{{ stageLabel() }}</span>
    </div>

    <p class="task-meta">
      创建于 {{ formatTime(task.created_at) }}
      <template v-if="task.status === 'succeeded' && task.result">
        · 音频时长 {{ formatSeconds(task.result.duration) }}
        · 处理耗时 {{ formatSeconds(task.result.processing_time) }}
      </template>
    </p>

    <p v-if="task.error" role="alert" class="error-text">
      错误 {{ task.error.code }}：{{ task.error.detail }}
    </p>
    <p
      v-else-if="task.status === 'succeeded' && !hasText"
      class="hint"
    >
      任务已完成，但未识别到语音内容。
    </p>

    <pre
      v-if="hasText"
      class="subtitle-preview"
      :class="{ collapsed: !expanded }"
    >{{ task.result?.text }}</pre>

    <div v-if="hasText || task.downloads" class="task-actions">
      <button
        v-if="hasText"
        type="button"
        class="action"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? "收起" : "展开全文" }}
      </button>
      <button
        v-if="hasText"
        type="button"
        class="action"
        :disabled="isCopying"
        @click="copyText"
      >
        {{ isCopying ? "正在复制…" : "复制文本" }}
      </button>
      <a
        v-if="task.downloads && task.status === 'succeeded'"
        class="action"
        :href="task.downloads.srt"
        download
      >下载 SRT</a>
      <a
        v-if="task.downloads && task.status === 'succeeded'"
        class="action"
        :href="task.downloads.lrc"
        download
      >下载 LRC</a>
    </div>

    <p v-if="copyMessage" role="status" class="hint">{{ copyMessage }}</p>
  </li>
</template>