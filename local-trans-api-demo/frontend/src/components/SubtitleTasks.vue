<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { describeApiError, fetchTaskList, submitSubtitle } from "../api";
import type { SubtitleMode, SubtitleTask } from "../types";
import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

const emit = defineEmits<{ (event: "active-change", value: boolean): void }>();

const PAGE_SIZE = 20;

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

let refreshTimer: number | undefined;
let refreshQueued = false;
let isDisposed = false;

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

async function refreshTasks() {
  if (isDisposed) return;
  // 顺序调度：同一时刻只允许一个刷新在途，其余请求排队到本轮结束后再执行。
  if (isRefreshing.value) {
    refreshQueued = true;
    return;
  }

  isRefreshing.value = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  try {
    // 查询第一页，用它判断全局是否存在活动任务。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);
    if (isDisposed) return;

    total.value = firstPage.total;

    // 记录过期导致当前页超出范围时，回到最后一个有效页。
    const lastPage = Math.max(1, Math.ceil(firstPage.total / PAGE_SIZE));
    if (page.value > lastPage) page.value = lastPage;

    // 用户查看历史页时，再查询对应分页。
    const visiblePage =
      page.value === 1
        ? firstPage
        : await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);

    if (isDisposed) return;

    tasks.value = visiblePage.tasks;
    total.value = visiblePage.total;
    offlineNotice.value = "";

    // 刷新失败或列表尚未包含刚受理的任务时，保留它，避免“提交成功但任务消失”。
    if (
      page.value === 1 &&
      acceptedTask.value &&
      !tasks.value.some((task) => task.id === acceptedTask.value?.id)
    ) {
      tasks.value = [acceptedTask.value, ...tasks.value];
    }

    const hasActiveTasks = firstPage.tasks.some(
      (task) => task.status === "queued" || task.status === "running",
    );

    emit("active-change", hasActiveTasks);
    refreshDelay.value = hasActiveTasks ? 2000 : 5000;
  } catch (error) {
    // 请求失败保留已有任务和活动状态，仅提示断线。
    if (!isDisposed) {
      offlineNotice.value = describeApiError(error);
    }
  } finally {
    isRefreshing.value = false;

    if (!isDisposed) {
      const delay = refreshQueued ? 0 : refreshDelay.value;
      refreshQueued = false;
      refreshTimer = window.setTimeout(() => void refreshTasks(), delay);
    }
  }
}

async function submit() {
  if (isSubmitting.value || !selectedFile.value) return;

  isSubmitting.value = true;
  errorMessage.value = "";
  const submittedMode = mode.value;

  try {
    const accepted = await submitSubtitle(selectedFile.value, submittedMode);
    acceptedTask.value = accepted;

    // 成功受理后保留处理方式，清空已提交文件，切回第一页。
    selectedFile.value = null;
    page.value = 1;

    // 乐观插入，保证刷新失败或在途刷新覆盖时仍能看到刚受理的任务。
    if (!tasks.value.some((task) => task.id === accepted.id)) {
      tasks.value = [accepted, ...tasks.value];
    }

    void refreshTasks();
  } catch (error) {
    // 提交失败保留文件和模式，显示接口错误；队列已满不自动重试。
    errorMessage.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
  }
}

function goPage(next: number) {
  if (isRefreshing.value) return;
  const clamped = Math.min(Math.max(1, next), totalPages.value);
  if (clamped === page.value) return;
  page.value = clamped;
  void refreshTasks();
}

function manualRefresh() {
  if (isRefreshing.value) return;
  void refreshTasks();
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

<template>
  <section class="panel create-panel" aria-label="创建字幕">
    <h2 class="panel__title">创建字幕</h2>

    <form class="create-form" @submit.prevent="submit">
      <MediaFilePicker v-model="selectedFile" :disabled="isSubmitting" />

      <fieldset class="mode-group" :disabled="isSubmitting">
        <legend class="mode-legend">处理方式</legend>
        <label class="mode-card">
          <input type="radio" name="subtitle-mode" value="transcribe" v-model="mode" />
          <span class="mode-card__text">日语转录</span>
        </label>
        <label class="mode-card">
          <input type="radio" name="subtitle-mode" value="translate" v-model="mode" />
          <span class="mode-card__text">日语翻译成中文</span>
        </label>
      </fieldset>

      <button
        type="submit"
        class="button-primary create-submit"
        :disabled="!selectedFile || isSubmitting"
      >
        {{ isSubmitting ? "正在上传…" : "生成字幕" }}
      </button>

      <p v-if="errorMessage" role="alert" class="notice notice--error">
        {{ errorMessage }}
      </p>
      <p v-if="acceptedTask" role="status" class="notice notice--ok">
        已受理，任务编号：{{ acceptedTask.id }}
      </p>
    </form>
  </section>

  <section class="panel tasks-panel" aria-label="任务记录">
    <div class="tasks-panel__head">
      <h2 class="panel__title">任务记录</h2>
      <button
        type="button"
        class="button-ghost"
        :disabled="isRefreshing"
        @click="manualRefresh"
      >
        {{ isRefreshing ? "刷新中…" : "刷新" }}
      </button>
    </div>

    <p v-if="offlineNotice" role="alert" class="notice notice--error">
      {{ offlineNotice }}
    </p>

    <p v-if="!tasks.length" class="hint">暂无任务，请先提交音视频。</p>

    <SubtitleTaskCard v-for="task in tasks" :key="task.id" :task="task" />

    <nav class="pagination" aria-label="任务分页">
      <button
        type="button"
        class="button-ghost"
        :disabled="page <= 1 || isRefreshing"
        @click="goPage(page - 1)"
      >
        上一页
      </button>
      <span class="pagination__info">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
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

<style scoped>
.panel__title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 650;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.mode-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  border: 0;
}

.mode-legend {
  padding: 0;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 13px;
}

.mode-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.mode-card:hover {
  background: var(--surface-hover);
}

.mode-card:has(input:checked) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
}

.mode-card input {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
}

.mode-card__text {
  font-size: 14px;
}

.create-submit {
  width: 100%;
}

.notice {
  margin: 0;
  font-size: 13px;
}

.notice--error {
  color: var(--danger);
}

.notice--ok {
  color: var(--success);
  word-break: break-all;
}

.tasks-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.tasks-panel__head .panel__title {
  margin: 0;
}

.hint {
  margin: 8px 0;
  color: var(--muted);
  font-size: 13px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.pagination__info {
  color: var(--muted);
  font-size: 13px;
}

.button-ghost {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.button-ghost:hover:not(:disabled) {
  background: var(--surface-hover);
}
</style>
