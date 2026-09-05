<template>
  <div class="subtitle-flow">
    <section class="panel create-panel" aria-labelledby="create-title">
      <h2 id="create-title">创建字幕</h2>
      <form @submit.prevent="submit">
        <MediaFilePicker v-model="selectedFile" :disabled="isSubmitting" />

        <fieldset class="mode-field">
          <legend>处理方式</legend>
          <label class="mode-option" :class="{ 'is-selected': mode === 'transcribe' }">
            <input
              v-model="mode"
              type="radio"
              value="transcribe"
              :disabled="isSubmitting"
            />
            <span class="mode-text">
              <span class="mode-title">日语转录</span>
              <span class="mode-desc">保留日语原文，生成日文字幕</span>
            </span>
          </label>
          <label class="mode-option" :class="{ 'is-selected': mode === 'translate' }">
            <input
              v-model="mode"
              type="radio"
              value="translate"
              :disabled="isSubmitting"
            />
            <span class="mode-text">
              <span class="mode-title">日语翻译成中文</span>
              <span class="mode-desc">翻译为中文，生成中文字幕</span>
            </span>
          </label>
        </fieldset>

        <button
          type="submit"
          class="button-primary"
          :disabled="!selectedFile || isSubmitting"
        >
          {{ isSubmitting ? "正在上传…" : "生成字幕" }}
        </button>

        <p v-if="errorMessage" role="alert" class="error-text">{{ errorMessage }}</p>
        <p v-if="acceptedTaskId" role="status" class="accepted">
          已受理，任务编号：{{ acceptedTaskId }}
        </p>
      </form>
    </section>

    <section class="panel tasks-panel" aria-labelledby="tasks-title">
      <div class="tasks-head">
        <h2 id="tasks-title">任务记录</h2>
        <button
          type="button"
          class="button-secondary"
          :disabled="isRefreshing"
          @click="refreshNow"
        >
          {{ isRefreshing ? "正在刷新…" : "刷新" }}
        </button>
      </div>

      <p v-if="offlineNotice" role="alert" class="error-text">{{ offlineNotice }}</p>
      <p v-if="showInitialLoading" class="hint">正在加载任务…</p>
      <p v-else-if="!tasks.length && !offlineNotice" class="hint">
        暂无任务，请先提交音视频。
      </p>

      <ul v-if="tasks.length" class="task-list">
        <li v-for="task in tasks" :key="task.id">
          <SubtitleTaskCard :task="task" />
        </li>
      </ul>

      <nav v-if="totalPages > 1" class="pagination" aria-label="任务分页">
        <button
          type="button"
          class="button-secondary"
          :disabled="page <= 1 || isRefreshing"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="page-indicator">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button
          type="button"
          class="button-secondary"
          :disabled="page >= totalPages || isRefreshing"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>
      </nav>
    </section>
  </div>
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

const emit = defineEmits<{ (event: "active-change", value: boolean): void }>();

const PAGE_SIZE = 20;
const ACTIVE_DELAY_MS = 2000;
const IDLE_DELAY_MS = 5000;

const selectedFile = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const errorMessage = ref("");
const acceptedTaskId = ref("");

const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const offlineNotice = ref("");
const isRefreshing = ref(false);
const refreshDelay = ref(IDLE_DELAY_MS);
const hasLoadedOnce = ref(false);

let refreshTimer: number | undefined;
let isDisposed = false;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const showInitialLoading = computed(
  () => !hasLoadedOnce.value && !offlineNotice.value,
);

async function refreshTasks() {
  if (isRefreshing.value || isDisposed) return;

  isRefreshing.value = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  try {
    // 始终先查第一页：列表按创建时间倒序，活动任务（最多 1 运行 + 3 排队）
    // 一定落在第一页，用它判断全局活动状态，与当前浏览页无关。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);

    let visiblePage =
      page.value === 1
        ? firstPage
        : await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);

    if (isDisposed) return;

    // 任务过期被清理后当前页可能变空，回退到最后一个有效页并重取。
    if (visiblePage.tasks.length === 0 && visiblePage.total > 0 && page.value > 1) {
      const lastPage = Math.max(1, Math.ceil(visiblePage.total / PAGE_SIZE));
      page.value = lastPage;
      visiblePage = await fetchTaskList(PAGE_SIZE, (lastPage - 1) * PAGE_SIZE);
      if (isDisposed) return;
    }

    tasks.value = visiblePage.tasks;
    total.value = visiblePage.total;
    offlineNotice.value = "";
    hasLoadedOnce.value = true;

    const hasActiveTasks = firstPage.tasks.some(
      (task) => task.status === "queued" || task.status === "running",
    );

    emit("active-change", hasActiveTasks);
    refreshDelay.value = hasActiveTasks ? ACTIVE_DELAY_MS : IDLE_DELAY_MS;
  } catch (error) {
    if (!isDisposed) {
      // 刷新失败保留已有任务和活动状态，仅提示断线。
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

function refreshNow() {
  void refreshTasks();
}

function goToPage(next: number) {
  if (isRefreshing.value) return;
  const clamped = Math.min(Math.max(1, next), totalPages.value);
  if (clamped === page.value) return;
  page.value = clamped;
  void refreshTasks();
}

async function submit() {
  if (isSubmitting.value || !selectedFile.value) return;

  isSubmitting.value = true;
  errorMessage.value = "";
  acceptedTaskId.value = "";

  try {
    const accepted = await submitSubtitle(selectedFile.value, mode.value);
    if (isDisposed) return;

    // 受理成功：保留处理方式，清空已提交文件，切回第一页并展示任务编号。
    acceptedTaskId.value = accepted.id;
    selectedFile.value = null;

    // 先把已受理任务放进列表，即使紧随其后的刷新失败，任务也不会“消失”。
    if (page.value !== 1) {
      page.value = 1;
      tasks.value = [accepted];
    } else if (!tasks.value.some((task) => task.id === accepted.id)) {
      tasks.value = [accepted, ...tasks.value];
    }
    total.value += 1;

    emit("active-change", true);

    // 提交成功后安排一次刷新；若恰逢轮询进行中，下一轮定时刷新会补上。
    void refreshTasks();
  } catch (error) {
    if (!isDisposed) {
      // 提交失败保留文件和模式，由用户决定是否再次提交；队列已满不自动重试。
      errorMessage.value = describeApiError(error);
    }
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  void refreshTasks();
});

onUnmounted(() => {
  isDisposed = true;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
});
</script>
