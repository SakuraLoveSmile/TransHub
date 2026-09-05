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

// 后端最多同时存在 1 个运行 + 3 个排队任务，且列表按 sequence 倒序返回，
// 因此第一页（20 条）足以覆盖全部活动任务，用它判断全局活动状态。
const PAGE_SIZE = 20;

const file = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const errorMessage = ref("");
const acceptedNotice = ref("");
const acceptedTask = ref<SubtitleTask | null>(null);
const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const offlineNotice = ref("");
const isRefreshing = ref(false);
const refreshDelay = ref(5000);

let refreshTimer: number | undefined;
let refreshRequested = false;
let isDisposed = false;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function isActive(task: SubtitleTask): boolean {
  return task.status === "queued" || task.status === "running";
}

function scheduleRefresh(delay = 0): void {
  if (isDisposed) return;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = window.setTimeout(() => void refreshTasks(), delay);
}

async function refreshTasks(): Promise<void> {
  if (isDisposed) return;

  // 串行调度：一次刷新完成前不发起下一次请求。
  if (isRefreshing.value) {
    refreshRequested = true;
    return;
  }

  isRefreshing.value = true;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  refreshRequested = false;

  try {
    // 查询第一页，用它判断全局是否存在活动任务。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);

    // 用户查看历史页时，再查询对应分页。
    let visiblePage = firstPage;
    if (page.value > 1) {
      visiblePage = await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);

      // 记录过期导致当前页为空时，回到最后一个有效页。
      if (visiblePage.tasks.length === 0) {
        const lastPage = Math.max(1, Math.ceil(visiblePage.total / PAGE_SIZE));
        page.value = lastPage;
        visiblePage =
          lastPage === 1
            ? firstPage
            : await fetchTaskList(PAGE_SIZE, (lastPage - 1) * PAGE_SIZE);
      }
    }

    if (isDisposed) return;

    tasks.value = visiblePage.tasks;
    total.value = visiblePage.total;
    offlineNotice.value = "";

    const hasActiveTasks = firstPage.tasks.some(isActive);

    emit("active-change", hasActiveTasks);
    refreshDelay.value = hasActiveTasks ? 2000 : 5000;
  } catch (error) {
    if (!isDisposed) {
      offlineNotice.value = `任务列表刷新失败（${describeApiError(error)}），已有记录已保留。`;

      // 受理成功但刷新失败时，仍保留刚受理的任务。
      const pending = acceptedTask.value;
      if (pending && !tasks.value.some((task) => task.id === pending.id)) {
        tasks.value = [pending, ...tasks.value];
        total.value = Math.max(total.value, tasks.value.length);
        if (isActive(pending)) {
          emit("active-change", true);
          refreshDelay.value = 2000;
        }
      }
    }
  } finally {
    isRefreshing.value = false;

    if (!isDisposed) {
      refreshTimer = window.setTimeout(
        () => void refreshTasks(),
        refreshRequested ? 0 : refreshDelay.value,
      );
    }
  }
}

async function goToPage(next: number): Promise<void> {
  if (isRefreshing.value) return;
  const target = Math.min(Math.max(1, next), totalPages.value);
  if (target === page.value) return;
  page.value = target;
  await refreshTasks();
}

async function submit(): Promise<void> {
  if (isSubmitting.value || !file.value) return;

  isSubmitting.value = true;
  errorMessage.value = "";
  acceptedNotice.value = "";

  try {
    const task = await submitSubtitle(file.value, mode.value);
    acceptedTask.value = task;
    acceptedNotice.value = `已受理，任务编号：${task.id}`;
    // 受理成功：保留处理方式，清空已提交文件，回到第一页。
    file.value = null;
    page.value = 1;
    scheduleRefresh(0);
  } catch (error) {
    // 提交失败保留文件与模式，由用户决定是否再次提交；队列已满时不自动重试。
    errorMessage.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
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

<template>
  <div class="workspace">
    <div class="workspace-side">
      <section class="panel panel-create" aria-label="创建字幕">
        <h2>创建字幕</h2>
        <form @submit.prevent="submit">
          <MediaFilePicker v-model="file" :disabled="isSubmitting" />

          <fieldset class="mode-field" :disabled="isSubmitting">
            <legend>处理方式</legend>
            <label
              class="mode-option"
              :class="{ 'is-active': mode === 'transcribe' }"
            >
              <input
                v-model="mode"
                type="radio"
                name="subtitle-mode"
                value="transcribe"
                :disabled="isSubmitting"
              />
              <span class="mode-body">
                <strong>日语转录</strong>
                <small>生成日语字幕</small>
              </span>
            </label>
            <label
              class="mode-option"
              :class="{ 'is-active': mode === 'translate' }"
            >
              <input
                v-model="mode"
                type="radio"
                name="subtitle-mode"
                value="translate"
                :disabled="isSubmitting"
              />
              <span class="mode-body">
                <strong>日语翻译成中文</strong>
                <small>生成中文字幕</small>
              </span>
            </label>
          </fieldset>

          <button
            type="submit"
            class="button-primary"
            :disabled="!file || isSubmitting"
          >
            {{ isSubmitting ? "正在上传…" : "生成字幕" }}
          </button>

          <p v-if="errorMessage" role="alert" class="message-alert">
            {{ errorMessage }}
          </p>
          <p v-if="acceptedNotice" role="status" class="message-status">
            {{ acceptedNotice }}
          </p>
        </form>
      </section>

      <slot name="aside" />
    </div>

    <section class="panel panel-tasks" aria-label="任务记录">
      <div class="tasks-head">
        <h2>任务记录</h2>
        <button
          type="button"
          class="button-secondary"
          :disabled="isRefreshing"
          @click="scheduleRefresh(0)"
        >
          刷新
        </button>
      </div>

      <p v-if="offlineNotice" role="alert" class="message-alert">
        {{ offlineNotice }}
      </p>
      <p v-if="!tasks.length" class="text-hint">
        暂无任务，请先选择音视频并提交。
      </p>

      <ul class="task-list">
        <SubtitleTaskCard
          v-for="task in tasks"
          :key="task.id"
          :task="task"
        />
      </ul>

      <div class="pager">
        <button
          type="button"
          class="button-secondary"
          :disabled="page <= 1 || isRefreshing"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="text-hint">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button
          type="button"
          class="button-secondary"
          :disabled="page >= totalPages || isRefreshing"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
form {
  display: grid;
  gap: 16px;
}

.mode-field {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.mode-field legend {
  padding: 0;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 13px;
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
}

.mode-option.is-active {
  border-color: var(--accent);
  background: rgba(165, 180, 252, 0.1);
}

.mode-body {
  display: grid;
  gap: 2px;
}

.mode-body strong {
  font-size: 14px;
  font-weight: 600;
}

.mode-body small {
  color: var(--muted);
  font-size: 12px;
}

.tasks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.tasks-head h2 {
  margin: 0;
}

.task-list {
  margin: 0;
  padding: 0;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>
