<template>
  <section class="create-panel panel" aria-label="创建字幕">
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
          <span class="mode-desc">识别日语语音并译为中文字幕</span>
        </label>
      </fieldset>

      <button
        type="submit"
        class="button-primary"
        :disabled="!selectedFile || isSubmitting"
      >
        {{ isSubmitting ? "正在上传…" : "生成字幕" }}
      </button>

      <p v-if="errorMessage" role="alert" class="error">
        {{ errorMessage }}
      </p>
      <p v-if="acceptedTask" role="status" class="accepted">
        已受理，任务编号：{{ acceptedTask.id }}
      </p>
    </form>
  </section>

  <section class="tasks-panel panel" aria-label="任务记录">
    <div class="tasks-head">
      <h2>任务记录</h2>
      <button
        type="button"
        class="button-ghost"
        :disabled="isRefreshing"
        @click="manualRefresh"
      >
        {{ isRefreshing ? "刷新中…" : "刷新" }}
      </button>
    </div>

    <p v-if="offlineNotice" role="alert" class="error">
      {{ offlineNotice }}
    </p>
    <p v-if="!tasks.length" class="hint">暂无任务，请先提交音视频。</p>
    <ul v-else class="task-list">
      <SubtitleTaskCard v-for="task in tasks" :key="task.id" :task="task" />
    </ul>

    <nav v-if="totalPages > 1" class="pager" aria-label="任务分页">
      <button
        type="button"
        class="button-ghost"
        :disabled="page <= 1 || isRefreshing"
        @click="goPage(page - 1)"
      >
        上一页
      </button>
      <span class="page-info">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
      <button
        type="button"
        class="button-ghost"
        :disabled="page >= totalPages || isRefreshing"
        @click="goPage(page + 1)"
      >
        下一页
      </button>
    </nav>
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

const PAGE_SIZE = 20;

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
const refreshDelay = ref(5000);
let isDisposed = false;
let refreshTimer: number | undefined;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function isActiveTask(task: SubtitleTask): boolean {
  return task.status === "queued" || task.status === "running";
}

async function submit() {
  // 提交锁：连续点击只产生一次上传。
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
    // 单次提交：队列已满等失败直接报错，不自动重试上传。
    acceptedTask.value = await submitSubtitle(file, submitMode);
    // 成功受理：保留处理方式，清空文件，切回第一页。
    selectedFile.value = null;
    page.value = 1;
    // 受理后即使刷新失败也保留已受理任务（refreshOnce 内部吞错不丢旧态）。
    await refreshOnce();
  } catch (error) {
    // 失败：保留文件与模式，由用户决定是否再次提交。
    errorMessage.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
  }
}

async function refreshOnce() {
  // 顺序调度：轮询、手动刷新与提交后刷新共用此锁，请求永不重叠。
  if (isRefreshing.value || isDisposed) return;
  isRefreshing.value = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  try {
    // 第一页用于判断全局是否存在活动任务（也是首页正在展示的分页）。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);
    if (isDisposed) return;

    const visiblePage =
      page.value === 1
        ? firstPage
        : await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);
    if (isDisposed) return;

    // 当前页为空（记录过期清理）时回到最后一个有效页。
    let finalPage = page.value;
    let finalTasks = visiblePage.tasks;
    let finalTotal = visiblePage.total;
    if (visiblePage.tasks.length === 0 && page.value > 1) {
      finalPage = Math.max(
        1,
        Math.min(
          page.value - 1,
          Math.max(1, Math.ceil(visiblePage.total / PAGE_SIZE)),
        ),
      );
      const retry = await fetchTaskList(
        PAGE_SIZE,
        (finalPage - 1) * PAGE_SIZE,
      );
      if (isDisposed) return;
      finalTasks = retry.tasks;
      finalTotal = retry.total;
    }

    tasks.value = finalTasks;
    total.value = finalTotal;
    page.value = finalPage;
    offlineNotice.value = "";

    const hasActiveTasks = firstPage.tasks.some(isActiveTask);
    emit("active-change", hasActiveTasks);
    refreshDelay.value = hasActiveTasks ? 2000 : 5000;
  } catch (error) {
    // 刷新失败保留已有任务、分页与活动状态，仅提示断线，不自动重传。
    if (!isDisposed) {
      offlineNotice.value = `任务列表刷新失败（${describeApiError(error)}），已有记录已保留。`;
    }
  } finally {
    isRefreshing.value = false;

    if (!isDisposed) {
      refreshTimer = window.setTimeout(
        () => void refreshTasks(),
        refreshDelay.value,
      );
    }
  }
}

async function refreshTasks() {
  await refreshOnce();
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
  void refreshOnce();
});

onUnmounted(() => {
  isDisposed = true;
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
});
</script>

<style scoped>
.create-panel {
  grid-area: create;
}

.tasks-panel {
  grid-area: tasks;
}

form {
  display: grid;
  gap: 12px;
}

.tasks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.mode-group {
  display: grid;
  grid-template-columns: 1fr;
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
  grid-template-columns: auto 1fr;
  grid-template-areas:
    "radio title"
    "radio desc";
  column-gap: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  cursor: pointer;
  background: var(--surface-2);
}

.mode-card:hover {
  background: var(--surface-hover);
}

.mode-card input {
  grid-area: radio;
  align-self: start;
  margin-top: 4px;
}

.mode-title {
  grid-area: title;
  font-weight: 600;
}

.mode-desc {
  grid-area: desc;
  font-size: 12px;
  color: var(--muted);
}

.mode-card.is-checked {
  border-color: var(--accent);
  background: var(--surface-hover);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}

.page-info {
  font-size: 13px;
  color: var(--muted);
}

@media (max-width: 599px) {
  .mode-group {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
