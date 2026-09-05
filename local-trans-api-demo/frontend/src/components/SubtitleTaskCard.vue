<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../api";

const props = defineProps<{ task: SubtitleTask }>();

const expanded = ref(false);
const copyMessage = ref("");
const copyTone = ref<"ok" | "warn">("ok");
const isCopying = ref(false);

const STATUS_LABELS: Record<SubtitleTask["status"], string> = {
  queued: "排队中",
  running: "处理中",
  succeeded: "已完成",
  failed: "失败",
};

const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  loading_model: "加载模型",
  processing: "处理音频",
  writing_output: "写入字幕",
  completed: "完成",
  failed: "失败",
};

const statusLabel = computed(() => STATUS_LABELS[props.task.status]);

const stageLabel = computed(() => {
  if (props.task.status === "succeeded") return "完成";
  if (props.task.status === "failed") return "失败";
  return STAGE_LABELS[props.task.stage] ?? props.task.stage;
});

const isActive = computed(
  () => props.task.status === "queued" || props.task.status === "running",
);

const modeLabel = computed(() =>
  props.task.mode === "transcribe" ? "日语转录" : "日语翻译成中文",
);

const createdAtText = computed(() => formatLocalTime(props.task.created_at));

const resultText = computed(() => props.task.result?.text ?? "");

const needsClamp = computed(() => {
  const text = resultText.value;
  if (!text) return false;
  return text.split("\n").length > 6 || text.length > 300;
});

const showToggle = computed(() => needsClamp.value);

function formatLocalTime(value: string): string {
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
  copyTone.value = "ok";

  try {
    if (!navigator.clipboard?.writeText) {
      copyTone.value = "warn";
      copyMessage.value = "当前浏览器不支持复制，请展开后手动选择文本。";
      return;
    }

    await navigator.clipboard.writeText(text);
    copyMessage.value = "已复制";
  } catch {
    copyTone.value = "warn";
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
  <article class="task-card" :aria-label="`任务 ${task.original_name}`">
    <header class="task-card-head">
      <strong class="file-name">{{ task.original_name }}</strong>
      <span class="badge badge-mode">{{ modeLabel }}</span>
      <span v-if="task.mock" class="badge badge-mock">Mock</span>
      <span class="badge" :class="`badge-status-${task.status}`">
        {{ statusLabel }}
      </span>
    </header>

    <p class="task-meta">
      <span>创建时间：{{ createdAtText }}</span>
      <span v-if="isActive">当前阶段：{{ stageLabel }}</span>
    </p>

    <p v-if="task.error" role="alert" class="task-error">
      {{ task.error.code }}：{{ task.error.detail }}
    </p>

    <template v-else-if="task.status === 'succeeded' && task.result">
      <p class="task-result-meta">
        音频时长 {{ formatSeconds(task.result.duration) }} · 处理耗时
        {{ formatSeconds(task.result.processing_time) }} · 模型
        {{ task.result.model }}
      </p>

      <template v-if="resultText">
        <p class="task-preview" :class="{ 'is-clamped': !expanded && needsClamp }">
          {{ resultText }}
        </p>
      </template>
      <p v-else class="empty-hint">未识别到语音。</p>
    </template>

    <p v-else-if="task.status === 'succeeded'" class="empty-hint">
      未识别到语音。
    </p>

    <div class="task-actions">
      <button
        v-if="showToggle"
        type="button"
        class="button-secondary"
        @click="toggleExpanded"
      >
        {{ expanded ? "收起" : "展开全文" }}
      </button>
      <button
        type="button"
        class="button-secondary"
        :disabled="!resultText || isCopying"
        :title="!resultText ? '未识别到语音，没有可复制的文本' : undefined"
        @click="copyText"
      >
        {{ isCopying ? "正在复制…" : "复制文本" }}
      </button>
      <template v-if="task.status === 'succeeded' && task.downloads">
        <a class="button-secondary" :href="task.downloads.srt" download>
          下载 SRT
        </a>
        <a class="button-secondary" :href="task.downloads.lrc" download>
          下载 LRC
        </a>
      </template>
      <p
        v-if="copyMessage"
        role="status"
        class="copy-status"
        :class="{ 'is-error': copyTone === 'warn' }"
      >
        {{ copyMessage }}
      </p>
    </div>
  </article>
</template>
