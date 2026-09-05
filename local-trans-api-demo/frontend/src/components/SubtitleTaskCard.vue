<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubtitleTask } from "../types";

const props = defineProps<{ task: SubtitleTask }>();

const isExpanded = ref(false);
const copyMessage = ref("");
const isCopying = ref(false);

const timeLabel = computed(() => {
  if (!props.task.created_at) return "—";
  try {
    const d = new Date(props.task.created_at);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString() + " (本地时间)";
  } catch {
    return "—";
  }
});

function stageLabel(task: SubtitleTask): string {
  const stages: Record<string, string> = {
    queued: "排队中",
    loading_model: "加载模型",
    processing: "处理中",
    writing_output: "写入字幕",
    completed: "已完成",
    failed: "失败",
  };
  if (task.status === "succeeded") return "已完成";
  if (task.status === "failed") return "失败";
  return stages[task.stage] ?? task.stage;
}

const statusClass = computed(() => {
  return props.task.status === "succeeded"
    ? "success"
    : props.task.status === "failed"
      ? "failed"
      : "running";
});

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

const textLines = computed(() => {
  if (!props.task.result?.text) return [];
  return props.task.result.text.split("\n");
});

const isTruncated = computed(() => textLines.value.length > 6);
const displayLines = computed(() => {
  if (isExpanded.value || !isTruncated.value) return textLines.value;
  return textLines.value.slice(0, 6);
});
</script>

<template>
  <div class="task-card">
    <div class="header">
      <div class="title-row">
        <strong class="filename">{{ task.original_name }}</strong>
        <span class="badge mode">{{ task.mode === 'transcribe' ? '日语转录' : '日译中' }}</span>
        <span v-if="task.mock" class="badge mock">模拟</span>
      </div>
      <div class="meta-row">
        <span class="time">{{ timeLabel }}</span>
        <span class="stage" :class="statusClass">当前阶段：{{ stageLabel(task) }}</span>
      </div>
    </div>

    <div v-if="task.error" class="error-box" role="alert">
      {{ task.error.code }}：{{ task.error.detail }}
    </div>

    <template v-else-if="task.status === 'succeeded'">
      <div class="stats" v-if="task.result">
        音频时长：{{ task.result.duration.toFixed(1) }}s · 
        处理耗时：{{ task.result.processing_time.toFixed(1) }}s
      </div>
      
      <div v-if="!task.result?.text" class="empty-result">
        未识别到语音。
      </div>
      <div v-else class="text-content">
        <div class="text-lines">
          <div v-for="(line, idx) in displayLines" :key="idx" class="line">{{ line }}</div>
        </div>
        <div v-if="isTruncated && !isExpanded" class="expand-fade"></div>
      </div>

      <div class="actions">
        <button 
          v-if="isTruncated"
          type="button" 
          class="action-btn"
          @click="isExpanded = !isExpanded"
        >
          {{ isExpanded ? '收起全文' : '展开全文' }}
        </button>
        <div class="spacer"></div>
        
        <span v-if="copyMessage" class="copy-msg" role="status">{{ copyMessage }}</span>
        <button 
          type="button" 
          class="action-btn"
          :disabled="!task.result?.text || isCopying"
          @click="copyText"
        >
          复制文本
        </button>

        <a v-if="task.downloads?.srt" :href="task.downloads.srt" download class="action-btn link-btn">SRT</a>
        <a v-if="task.downloads?.lrc" :href="task.downloads.lrc" download class="action-btn link-btn">LRC</a>
      </div>
    </template>
  </div>
</template>

<style scoped>
.task-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-hover);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.filename {
  font-size: 15px;
  word-break: break-all;
}

.badge {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.mode {
  background: rgba(255, 255, 255, 0.1);
  color: var(--muted);
}

.mock {
  background: rgba(252, 211, 77, 0.1);
  color: var(--warning);
  border: 1px solid rgba(252, 211, 77, 0.2);
}

.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--muted);
}

.stage.success { color: var(--success); }
.stage.failed { color: var(--danger); }
.stage.running { color: var(--accent); }

.error-box {
  padding: 12px;
  background: rgba(253, 164, 175, 0.1);
  border-left: 4px solid var(--danger);
  border-radius: 4px;
  color: var(--danger);
  font-size: 14px;
}

.stats {
  font-size: 13px;
  color: var(--muted);
}

.empty-result {
  color: var(--muted);
  font-size: 14px;
  font-style: italic;
}

.text-content {
  position: relative;
  background: var(--bg);
  padding: 12px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
}

.text-lines {
  overflow: hidden;
}

.line {
  min-height: 1.5em; /* preserve empty lines */
}

.expand-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--bg));
  pointer-events: none;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.spacer {
  flex-grow: 1;
}

.copy-msg {
  font-size: 12px;
  color: var(--success);
}

.action-btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.link-btn {
  line-height: normal;
}
</style>
