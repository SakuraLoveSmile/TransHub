<template>
  <div class="subtitle-workspace">
    <section class="panel panel-create" aria-label="创建字幕">
      <h2 class="panel-title">创建字幕</h2>
      <form class="form-grid" @submit.prevent="submit">
        <MediaFilePicker v-model="selectedFile" :disabled="isSubmitting" />

        <fieldset class="mode-options">
          <legend class="field-label">处理方式</legend>
          <label class="mode-option" :class="{ selected: mode === 'transcribe' }">
            <input
              v-model="mode"
              type="radio"
              name="subtitle-mode"
              value="transcribe"
              :disabled="isSubmitting"
            />
            <span class="mode-option-body">
              <span class="mode-title">日语转录</span>
              <span class="mode-hint">把日语音频转成日语文本</span>
            </span>
          </label>
          <label class="mode-option" :class="{ selected: mode === 'translate' }">
            <input
              v-model="mode"
              type="radio"
              name="subtitle-mode"
              value="translate"
              :disabled="isSubmitting"
            />
            <span class="mode-option-body">
              <span class="mode-title">日语翻译成中文</span>
              <span class="mode-hint">生成中文字幕文本</span>
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

        <p v-if="submitError" role="alert" class="alert-error">{{ submitError }}</p>
        <p v-if="acceptedTask" role="status" class="notice-ok">
          已受理，任务编号：{{ acceptedTask.id }}
        </p>
      </form>
    </section>

    <section class="panel panel-tasks" aria-label="任务记录">
      <div class="panel-header">
        <h2 class="panel-title">任务记录</h2>
        <button
          type="button"
          class="button-small"
          :disabled="isRefreshing"
          @click="manualRefresh"
        >
          刷新
        </button>
      </div>

      <p v-if="offlineNotice" role="alert" class="alert-error">{{ offlineNotice }}</p>
      <p v-else-if="!tasks.length" class="hint">
        暂无任务，提交音视频后会显示在这里。
      </p>

      <div v-if="tasks.length" class="task-list">
        <SubtitleTaskCard v-for="task in tasks" :key="task.id" :task="task" />
      </div>

      <nav v-if="total > 0" class="pagination" aria-label="任务分页">
        <button
          type="button"
          class="button-small"
          :disabled="page <= 1 || isRefreshing"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="pagination-info">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button
          type="button"
          class="button-small"
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
import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import {
  describeApiError,
  fetchTaskList,
  submitSubtitle,
  type SubtitleMode,
  type SubtitleTask,
} from "../api";

const emit = defineEmits<{ (event: "active-change", value: boolean): void }>();

const PAGE_SIZE = 20;
const ACTIVE_INTERVAL = 2000;
const IDLE_INTERVAL = 5000;

// —— 创建字幕状态 ——
const selectedFile = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const submitError = ref("");
const acceptedTask = ref<SubtitleTask | null>(null);

// —— 任务记录状态 ——
const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const offlineNotice = ref("");
const isRefreshing = ref(false);
let refreshTimer: number | undefined;
let refreshDelay = IDLE_INTERVAL;
let isDisposed = false;

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

async function submit() {
  if (isSubmitting.value || !selectedFile.value) return;

  isSubmitting.value = true;
  submitError.value = "";
  acceptedTask.value = null;

  try {
    const task = await submitSubtitle(selectedFile.value, mode.value);
    // 受理成功：保留处理方式，清空文件，切回第一页展示任务编号。
    selectedFile.value = null;
    acceptedTask.value = task;
    page.value = 1;
    await refreshTasks();
  } catch (error) {
    // 提交失败保留文件与模式，显示接口错误，由用户决定是否再次提交。
    // 队列已满等情况不做自动重试。
    submitError.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
  }
}

function manualRefresh() {
  void refreshTasks();
}

function goToPage(next: number) {
  if (isRefreshing.value) return;
  page.value = next;
  void refreshTasks();
}

async function refreshTasks() {
  if (isRefreshing.value || isDisposed) return;

  isRefreshing.value = true;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  try {
    // 查询第一页，用它判断全局是否存在活动任务。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);

    // 用户查看历史页时，再查询对应分页。
    let visiblePage =
      page.value === 1
        ? firstPage
        : await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);

    if (isDisposed) return;

    // 记录过期导致当前页为空时，回到最后一个有效页。
    if (!visiblePage.tasks.length && visiblePage.total > 0 && page.value > 1) {
      const lastPage = Math.max(1, Math.ceil(visiblePage.total / PAGE_SIZE));
      page.value = lastPage;
      visiblePage = await fetchTaskList(PAGE_SIZE, (lastPage - 1) * PAGE_SIZE);
      if (isDisposed) return;
    }

    tasks.value = visiblePage.tasks;
    total.value = visiblePage.total;
    offlineNotice.value = "";

    if (
      acceptedTask.value &&
      tasks.value.some((task) => task.id === acceptedTask.value?.id)
    ) {
      acceptedTask.value = null;
    }

    const hasActiveTasks = firstPage.tasks.some(
      (task) => task.status === "queued" || task.status === "running",
    );

    emit("active-change", hasActiveTasks);
    refreshDelay = hasActiveTasks ? ACTIVE_INTERVAL : IDLE_INTERVAL;
  } catch (error) {
    if (!isDisposed) {
      // 失败时保留已有任务与活动状态，仅提示断线。
      offlineNotice.value = `任务列表刷新失败：${describeApiError(error)}`;
    }
  } finally {
    isRefreshing.value = false;

    if (!isDisposed) {
      refreshTimer = window.setTimeout(
        () => void refreshTasks(),
        refreshDelay,
      );
    }
  }
}

onMounted(() => {
  isDisposed = false;
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
