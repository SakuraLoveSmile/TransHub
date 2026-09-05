<template>
  <section class="panel" aria-label="创建字幕">
    <h2>创建字幕</h2>
    <form @submit.prevent="submit">
      <MediaFilePicker v-model="selectedFile" :disabled="isSubmitting" />

      <fieldset class="mode-group" :disabled="isSubmitting">
        <legend>处理方式</legend>
        <label
          class="mode-card"
          :class="{ 'is-checked': mode === 'transcribe' }"
        >
          <input
            type="radio"
            name="subtitle-mode"
            value="transcribe"
            v-model="mode"
            :disabled="isSubmitting"
          />
          <span class="mode-title">日语转录</span>
          <span class="mode-desc">识别日语语音为日文字幕</span>
        </label>
        <label
          class="mode-card"
          :class="{ 'is-checked': mode === 'translate' }"
        >
          <input
            type="radio"
            name="subtitle-mode"
            value="translate"
            :disabled="isSubmitting"
            v-model="mode"
          />
          <span class="mode-title">日语翻译成中文</span>
          <span class="mode-desc">识别日语并译为中文字幕</span>
        </label>
      </fieldset>

      <button type="submit" :disabled="!selectedFile || isSubmitting">
        {{ isSubmitting ? "正在上传…" : "生成字幕" }}
      </button>

      <p v-if="errorMessage" role="alert" class="error">{{ errorMessage }}</p>
      <p v-if="acceptedTask" class="accepted">
        已受理，任务编号：{{ acceptedTask.id }}
      </p>
    </form>

    <div class="tasks" aria-label="任务记录">
      <div class="tasks-head">
        <h3>任务记录</h3>
        <button
          type="button"
          class="ghost-button"
          :disabled="isRefreshing"
          @click="manualRefresh"
        >
          {{ isRefreshing ? "刷新中…" : "刷新" }}
        </button>
      </div>
      <p v-if="offlineNotice" role="alert" class="error">{{ offlineNotice }}</p>
      <p v-if="!tasks.length" class="hint">暂无任务，请先提交音视频。</p>
      <ul v-else>
        <SubtitleTaskCard
          v-for="task in tasks"
          :key="task.id"
          :task="task"
        />
      </ul>
      <nav v-if="totalPages > 1" class="pager" aria-label="任务分页">
        <button
          type="button"
          class="ghost-button"
          :disabled="page <= 1 || isRefreshing"
          @click="goPage(page - 1)"
        >
          上一页
        </button>
        <span class="page-info">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button
          type="button"
          class="ghost-button"
          :disabled="page >= totalPages || isRefreshing"
          @click="goPage(page + 1)"
        >
          下一页
        </button>
      </nav>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  describeApiError,
  fetchTaskList,
  submitSubtitle,
  type SubtitleMode,
  type SubtitleTask,
} from "../api";
import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

const PAGE_SIZE = 10;

const emit = defineEmits<{ (event: "active-change", value: boolean): void }>();

const selectedFile = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const errorMessage = ref("");
const acceptedTask = ref<SubtitleTask | null>(null);
const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const offlineNotice = ref("");
const isRefreshing = ref(false);
let isDisposed = false;
let polling = false;

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

function isActiveTask(task: SubtitleTask): boolean {
  return task.status === "queued" || task.status === "running";
}

async function submit() {
  // 提交锁：提交中或连续点击不触发重复上传。
  if (isSubmitting.value || !selectedFile.value) return;
  if (selectedFile.value.size === 0) {
    errorMessage.value = "文件为空，请选择有效的音视频文件。";
    return;
  }
  isSubmitting.value = true;
  errorMessage.value = "";
  const file = selectedFile.value;
  const submitMode = mode.value;
  try {
    // 单次提交：队列满等失败直接报错，不自动重试。
    acceptedTask.value = await submitSubtitle(file, submitMode);
    // 成功：保留处理方式，清空文件选择，回到第一页展示新任务编号。
    selectedFile.value = null;
    page.value = 1;
    // 受理后刷新失败也不丢弃已受理任务：refreshOnce 内部吞错保留旧态。
    await refreshOnce();
  } catch (error) {
    // 失败：保留文件选择与处理方式，用户可直接重试。
    errorMessage.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
  }
}

async function refreshOnce() {
  // 单顺序调度：一次只跑一轮刷新，轮询与手动刷新共用此锁。
  if (isRefreshing.value || isDisposed) return;
  isRefreshing.value = true;
  try {
    // 先查第一页判定活动态（active-change 以最新第一页为准）。
    const first = await fetchTaskList(PAGE_SIZE, 0);
    if (isDisposed) return;
    emit("active-change", first.tasks.some(isActiveTask));
    if (page.value === 1) {
      tasks.value = first.tasks;
      total.value = first.total;
    } else {
      const visible = await fetchTaskList(
        PAGE_SIZE,
        (page.value - 1) * PAGE_SIZE,
      );
      if (isDisposed) return;
      total.value = visible.total;
      if (visible.tasks.length === 0 && page.value > 1) {
        // 空页回退：当前页已无数据，退一页重查。
        page.value = Math.max(
          1,
          Math.min(page.value - 1, Math.max(1, Math.ceil(visible.total / PAGE_SIZE))),
        );
        const retry = await fetchTaskList(
          PAGE_SIZE,
          (page.value - 1) * PAGE_SIZE,
        );
        if (isDisposed) return;
        tasks.value = retry.tasks;
        total.value = retry.total;
      } else {
        tasks.value = visible.tasks;
      }
    }
    offlineNotice.value = "";
  } catch (error) {
    // 刷新失败保留已有任务与活动态，仅提示断线，不自动重传。
    offlineNotice.value = `任务列表刷新失败（${describeApiError(error)}），已有记录已保留。`;
  } finally {
    isRefreshing.value = false;
  }
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  // 上一次请求结束后再安排下一次，避免请求重叠。
  while (!isDisposed) {
    await refreshOnce();
    if (isDisposed) break;
    const active = tasks.value.some(isActiveTask);
    await new Promise((resolve) => setTimeout(resolve, active ? 2000 : 5000));
  }
  polling = false;
}

function goPage(next: number) {
  if (isRefreshing.value) return;
  page.value = next;
  void refreshOnce();
}

function manualRefresh() {
  void refreshOnce();
}

onMounted(() => {
  isDisposed = false;
  void pollLoop();
});

onUnmounted(() => {
  isDisposed = true;
});
</script>

<style scoped>
.panel {
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
form {
  display: grid;
  gap: 8px;
  max-width: 480px;
}
button[disabled] {
  opacity: 0.6;
}
.error {
  color: var(--error, #a00);
}
.accepted {
  color: var(--success, #0a5);
}
.hint {
  color: var(--muted, #666);
  font-size: 13px;
}
.mode-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  border: none;
  padding: 0;
  margin: 0;
}
.mode-group legend {
  font-weight: 600;
  padding: 0;
  margin-bottom: 4px;
}
.mode-card {
  display: grid;
  gap: 2px;
  border: 1px solid var(--border, #ccc);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  background: var(--surface, #fff);
}
.mode-card.is-checked {
  border-color: var(--accent, #4c8dff);
  background: var(--selected-bg, #eef4ff);
}
.mode-card input {
  margin: 0;
}
.mode-card input:focus-visible {
  outline: 2px solid var(--accent, #4c8dff);
  outline-offset: 2px;
}
.mode-title {
  font-weight: 600;
}
.mode-desc {
  font-size: 12px;
  color: var(--muted, #666);
}
.tasks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ghost-button {
  cursor: pointer;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  padding: 4px 12px;
  background: var(--button-bg, #f4f4f5);
  color: var(--text, #222);
  font-size: 13px;
  white-space: nowrap;
}
.ghost-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
ul {
  padding: 0;
  margin: 0;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}
.page-info {
  font-size: 13px;
  color: var(--muted, #666);
}
</style>
