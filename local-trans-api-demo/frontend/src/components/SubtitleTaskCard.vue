<template>
  <li class="task-card">
    <div class="task-head">
      <strong class="task-name">{{ task.original_name }}</strong>
      <span class="chip chip-neutral">{{ modeLabel }}</span>
      <span class="muted-text">{{ localTime }}（本地时间）</span>
      <span v-if="task.mock" class="mock-badge">模拟</span>
      <span class="stage">{{ stageLabel }}</span>
    </div>

    <p v-if="task.error" role="alert" class="error">
      {{ task.error.code }}：{{ task.error.detail }}
    </p>
    <p
      v-else-if="task.status === 'succeeded' && !hasText"
      class="hint"
    >
      未识别到语音（空结果）。
    </p>
    <p v-else-if="hasText" class="result-text" :class="{ collapsed: !expanded }">
      {{ resultText }}
    </p>

    <div class="text-actions">
      <button
        v-if="hasText"
        type="button"
        class="button-ghost"
        :aria-expanded="expanded"
        @click="toggle"
      >
        {{ expanded ? "收起" : "展开全文" }}
      </button>
      <button
        type="button"
        class="button-ghost"
        :disabled="!hasText || isCopying"
        @click="copyText"
      >
        {{ isCopying ? "复制中…" : "复制文本" }}
      </button>
      <span v-if="copyMessage" role="status" class="copy-feedback">{{
        copyMessage
      }}</span>
    </div>

    <p v-if="timingText" class="muted-text timing">{{ timingText }}</p>

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

const props = defineProps<{ task: SubtitleTask }>();

// 卡片内部只保存展示态（展开／复制反馈）；任务数据由父组件传入。
const expanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  loading_model: "加载模型",
  processing: "处理音频",
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
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
});

const resultText = computed(() => props.task.result?.text ?? "");
const hasText = computed(() => resultText.value.length > 0);

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

<style scoped>
.task-card {
  border-top: 1px solid var(--border-soft);
  padding: 12px 0;
  list-style: none;
}

.task-card:first-child {
  border-top: 0;
  padding-top: 0;
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

.stage {
  color: var(--accent-strong);
}

.error {
  margin: 8px 0 0;
}

.hint {
  margin: 8px 0 0;
}

.result-text {
  font-size: 14px;
  color: var(--text);
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

.copy-feedback {
  font-size: 13px;
  color: var(--success);
}

.timing {
  margin: 6px 0 0;
}

.downloads {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
</style>
