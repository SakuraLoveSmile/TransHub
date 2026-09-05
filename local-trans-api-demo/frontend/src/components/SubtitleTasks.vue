<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import { describeApiError, fetchTaskList, submitSubtitle } from "../api";
import type { SubtitleMode, SubtitleTask, TaskListResponse } from "../types";

const PAGE_SIZE = 20;
const ACTIVE_STATUSES = new Set(["queued", "running"]);

const emit = defineEmits<{
  (event: "active-change", value: boolean): void;
}>();

const selectedFile = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const submitError = ref("");
const acceptedTask = ref<SubtitleTask | null>(null);
const pendingAcceptedTask = ref<SubtitleTask | null>(null);

const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const refreshError = ref("");
const isRefreshing = ref(false);
const hasActiveTasks = ref(false);

let refreshTimer: number | undefined;
let refreshRequest: Promise<void> | null = null;
let refreshQueued = false;
let refreshDelay = 5000;
let isDisposed = false;

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const canGoPrevious = computed(() => page.value > 1);
const canGoNext = computed(() => page.value < pageCount.value);

function clearRefreshTimer() {
  if (refreshTimer === undefined) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
}

function scheduleRefresh(delay = refreshDelay) {
  if (isDisposed) return;
  clearRefreshTimer();
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refreshTasks();
  }, delay);
}

function isActive(task: SubtitleTask): boolean {
  return ACTIVE_STATUSES.has(task.status);
}

function mergeAcceptedTask(response: TaskListResponse): TaskListResponse {
  const accepted = pendingAcceptedTask.value;
  if (!accepted) return response;

  if (response.tasks.some((task) => task.id === accepted.id)) {
    pendingAcceptedTask.value = null;
    return response;
  }

  if (
    accepted.expires_at &&
    new Date(accepted.expires_at).getTime() <= Date.now()
  ) {
    pendingAcceptedTask.value = null;
    return response;
  }

  // Keep the accepted response visible if the first refresh races the write
  // or the service is temporarily unavailable after accepting the upload.
  const merged = {
    ...response,
    tasks: [accepted, ...response.tasks]
      .filter((task, index, entries) =>
        entries.findIndex((entry) => entry.id === task.id) === index,
      )
    .slice(0, PAGE_SIZE),
    total: response.total + 1,
  };
  pendingAcceptedTask.value = null;
  return merged;
}

function setActiveState(firstPage: TaskListResponse) {
  const nextValue = firstPage.tasks.some(isActive);
  hasActiveTasks.value = nextValue;
  emit("active-change", nextValue);
  refreshDelay = nextValue ? 2000 : 5000;
}

async function loadVisiblePage(
  firstPage: TaskListResponse,
  requestedPage: number,
): Promise<{ response: TaskListResponse; effectivePage: number }> {
  const lastValidPage = Math.max(1, Math.ceil(firstPage.total / PAGE_SIZE));
  const effectivePage = Math.min(requestedPage, lastValidPage);

  if (effectivePage === 1) {
    return { response: firstPage, effectivePage };
  }

  let response = await fetchTaskList(
    PAGE_SIZE,
    (effectivePage - 1) * PAGE_SIZE,
  );
  const latestLastPage = Math.max(1, Math.ceil(response.total / PAGE_SIZE));
  if (!response.tasks.length && latestLastPage < effectivePage) {
    if (latestLastPage === 1) {
      if (response.total === 0) return { response, effectivePage: 1 };
      return {
        response: { ...firstPage, total: response.total, offset: 0 },
        effectivePage: 1,
      };
    }
    response = await fetchTaskList(PAGE_SIZE, (latestLastPage - 1) * PAGE_SIZE);
    return { response, effectivePage: latestLastPage };
  }
  return { response, effectivePage };
}

async function refreshTasks(): Promise<void> {
  if (isDisposed) return;
  if (refreshRequest) {
    refreshQueued = true;
    return refreshRequest;
  }

  clearRefreshTimer();
  isRefreshing.value = true;
  const requestedPage = page.value;

  refreshRequest = (async () => {
    try {
      // The backend keeps at most four non-terminal tasks, so its first page
      // is the global activity source even while the user views older pages.
      const serverFirstPage = await fetchTaskList(PAGE_SIZE, 0);
      if (isDisposed) return;
      const firstPage = mergeAcceptedTask(serverFirstPage);
      if (page.value !== requestedPage) return;

      setActiveState(firstPage);
      const visible = await loadVisiblePage(firstPage, requestedPage);
      if (isDisposed) return;
      if (page.value !== requestedPage) return;

      if (visible.effectivePage !== page.value) {
        page.value = visible.effectivePage;
      }
      tasks.value = visible.response.tasks;
      total.value = visible.response.total;
      refreshError.value = "";
    } catch (error) {
      if (!isDisposed) {
        // Keep the last successful data and active state on a transient error.
        refreshError.value = `任务列表刷新失败：${describeApiError(error)}；已保留现有记录。`;
      }
    }
  })().finally(() => {
    const shouldQueueRefresh = refreshQueued;
    refreshQueued = false;
    refreshRequest = null;

    if (isDisposed) return;
    isRefreshing.value = false;
    if (shouldQueueRefresh) {
      scheduleRefresh(0);
      return;
    }
    scheduleRefresh();
  });

  return refreshRequest;
}

function goToPage(nextPage: number) {
  if (isRefreshing.value || nextPage < 1 || nextPage > pageCount.value) {
    return;
  }
  page.value = nextPage;
  void refreshTasks();
}

function refreshNow() {
  if (isRefreshing.value) return;
  void refreshTasks();
}

async function submit() {
  const file = selectedFile.value;
  if (isSubmitting.value || !file) return;

  isSubmitting.value = true;
  submitError.value = "";
  try {
    const accepted = await submitSubtitle(file, mode.value);
    if (isDisposed) return;

    acceptedTask.value = accepted;
    pendingAcceptedTask.value = accepted;
    if (isActive(accepted)) {
      hasActiveTasks.value = true;
      emit("active-change", true);
      refreshDelay = 2000;
    }
    selectedFile.value = null;
    page.value = 1;
    tasks.value = [
      accepted,
      ...tasks.value.filter((task) => task.id !== accepted.id),
    ].slice(0, PAGE_SIZE);
    total.value = Math.max(total.value, tasks.value.length);

    // If a poll is already running, this queues one follow-up refresh.
    void refreshTasks();
  } catch (error) {
    if (!isDisposed) submitError.value = describeApiError(error);
  } finally {
    if (!isDisposed) isSubmitting.value = false;
  }
}

onMounted(() => {
  isDisposed = false;
  void refreshTasks();
});

onUnmounted(() => {
  isDisposed = true;
  refreshQueued = false;
  clearRefreshTimer();
});
</script>

<template>
  <div class="subtitle-tasks">
    <section class="panel create-panel" aria-labelledby="create-subtitle-heading">
      <div class="panel-heading">
        <div>
          <p class="panel-kicker">CREATE</p>
          <h2 id="create-subtitle-heading">创建字幕</h2>
          <p class="panel-description">
            上传一个音视频，任务会在本机按所选方式生成字幕。
          </p>
        </div>
        <span class="local-badge">本机处理</span>
      </div>

      <form class="create-form" @submit.prevent="submit">
        <MediaFilePicker v-model="selectedFile" :disabled="isSubmitting" />

        <fieldset class="mode-options" :disabled="isSubmitting">
          <legend>处理方式</legend>
          <label class="mode-card">
            <input
              v-model="mode"
              type="radio"
              name="subtitle-mode"
              value="transcribe"
            />
            <span>
              <strong>日语转录</strong>
              <small>保留日语原文，适合制作日语字幕。</small>
            </span>
          </label>
          <label class="mode-card">
            <input
              v-model="mode"
              type="radio"
              name="subtitle-mode"
              value="translate"
            />
            <span>
              <strong>日语翻译成中文</strong>
              <small>生成中文结果，适合快速阅读和整理。</small>
            </span>
          </label>
        </fieldset>

        <button
          class="button-primary"
          type="submit"
          :disabled="!selectedFile || isSubmitting"
        >
          {{ isSubmitting ? "正在上传…" : "生成字幕" }}
        </button>

        <p v-if="submitError" class="inline-error" role="alert">
          {{ submitError }}
        </p>
        <p v-if="acceptedTask" class="accepted-note" role="status">
          已受理，任务编号：<code>{{ acceptedTask.id }}</code>
        </p>
      </form>
    </section>

    <section class="panel task-records" aria-labelledby="task-records-heading">
      <header class="task-records-header">
        <div>
          <p class="panel-kicker">WORKSPACE</p>
          <h2 id="task-records-heading">任务记录</h2>
          <p class="panel-description">
            {{ total ? `共 ${total} 条记录 · 按创建时间倒序` : "最新提交会显示在这里" }}
          </p>
        </div>
        <button
          class="button-quiet"
          type="button"
          :disabled="isRefreshing"
          @click="refreshNow"
        >
          {{ isRefreshing ? "刷新中…" : "刷新" }}
        </button>
      </header>

      <p v-if="isRefreshing && tasks.length" class="refreshing-note" role="status">
        正在同步最新任务状态…
      </p>
      <p v-if="refreshError" class="inline-error" role="alert">
        {{ refreshError }}
      </p>

      <div v-if="isRefreshing && !tasks.length" class="loading-state" role="status">
        正在加载任务记录…
      </div>
      <div v-else-if="!tasks.length" class="empty-state">
        暂无任务。选择音视频并点击“生成字幕”开始处理。
      </div>
      <div v-else class="task-list">
        <SubtitleTaskCard v-for="task in tasks" :key="task.id" :task="task" />
      </div>

      <footer v-if="total" class="pagination" aria-label="任务分页">
        <button
          type="button"
          :disabled="isRefreshing || !canGoPrevious"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="pagination-label">
          第 {{ page }} 页 / 共 {{ pageCount }} 页
        </span>
        <button
          type="button"
          :disabled="isRefreshing || !canGoNext"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>
      </footer>
    </section>
  </div>
</template>
