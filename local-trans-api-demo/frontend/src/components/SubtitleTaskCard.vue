<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../api";

const props = defineProps<{ task: SubtitleTask }>();

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
};

const STAGE_LABELS: Record<string, string> = {
  queued: "排队",
  loading_model: "加载模型",
  processing: "处理音频",
  writing_output: "写入字幕",
  completed: "完成",
  failed: "失败",
};

const PREVIEW_LINES = 6;

const expanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const statusText = computed(
  () => STATUS_LABELS[props.task.status] ?? "未知状态",
);

const stageText = computed(() => {
  if (props.task.status === "succeeded") return "完成";
  if (props.task.status === "failed") return "失败";
  return STAGE_LABELS[props.task.stage] ?? props.task.stage;
});

const modeText = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日语翻译成中文",
);

const resultText = computed(() => props.task.result?.text ?? "");
const hasResult = computed(() => resultText.value.length > 0);
const lines = computed(() =>
  hasResult.value ? resultText.value.split("\n") : [],
);
const isLong = computed(() => lines.value.length > PREVIEW_LINES);
const shownText = computed(() =>
  expanded.value || !isLong.value
    ? resultText.value
    : lines.value.slice(0, PREVIEW_LINES).join("\n"),
);
const isDone = computed(() => props.task.status === "succeeded");
const createdAtText = computed(() => formatLocalTime(props.task.created_at));
const metricsText = computed(() => {
  const result = props.task.result;
  if (!result) return "";
  return `音频时长 ${result.duration.toFixed(1)} 秒 · 处理耗时 ${result.processing_time.toFixed(1)} 秒`;
});

function formatLocalTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (input: number) => String(input).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} 本地时间`
  );
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

function toggleExpanded() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <article class="card" :aria-label="`任务 ${task.id}`">
    <div class="card-head">
      <div class="card-title">
        <strong class="file-name text-wrap">{{ task.original_name }}</strong>
        <span class="badge">{{ modeText }}</span>
        <span v-if="task.mock" class="badge badge-warning">模拟（Mock）</span>
      </div>
      <span
        class="badge"
        :class="{
          'badge-success': task.status === 'succeeded',
          'badge-danger': task.status === 'failed',
          'badge-info': task.status === 'running' || task.status === 'queued',
        }"
        >{{ statusText }}</span
      >
    </div>

    <p class="meta hint text-wrap">
      创建时间 {{ createdAtText }} · 当前阶段：{{ stageText }}
    </p>

    <p v-if="metricsText && isDone" class="hint">{{ metricsText }}</p>

    <p v-if="task.error" role="alert" class="error-text text-wrap">
      {{ task.error.code }}：{{ task.error.detail }}
    </p>

    <p v-else-if="isDone && !hasResult" class="hint">未识别到语音（空结果）。</p>

    <template v-else-if="hasResult">
      <p class="subtitle text-wrap">{{ shownText }}</p>
      <button
        v-if="isLong"
        type="button"
        class="button button-small"
        :aria-expanded="expanded"
        @click="toggleExpanded"
      >
        {{ expanded ? "收起" : "展开全文" }}
      </button>
    </template>

    <div class="actions">
      <button
        type="button"
        class="button button-small"
        :disabled="!hasResult || isCopying"
        @click="copyText"
      >
        {{ isCopying ? "复制中…" : "复制文本" }}
      </button>
      <a
        v-if="task.downloads"
        class="button button-small"
        :href="task.downloads.srt"
        download
        >下载 SRT</a
      >
      <a
        v-if="task.downloads"
        class="button button-small"
        :href="task.downloads.lrc"
        download
        >下载 LRC</a
      >
      <span v-if="copyMessage" role="status" class="hint">{{ copyMessage }}</span>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.file-name {
  max-width: 100%;
  line-height: 1.4;
}

.subtitle {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.55;
  color: var(--text);
}

a.button {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: var(--text);
}
</style>
