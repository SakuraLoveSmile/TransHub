<template>
  <section class="panel" aria-label="创建字幕">
    <h2 class="panel-title">创建字幕</h2>
    <form @submit.prevent="submit">
      <span class="field-label">音视频文件</span>
      <MediaFilePicker v-model="selectedFile" :disabled="isSubmitting" />

      <fieldset class="mode-group" :disabled="isSubmitting">
        <legend class="field-label">处理方式</legend>
        <label class="radio-card">
          <input v-model="mode" type="radio" name="mode" value="transcribe" />
          <span>日语转录</span>
        </label>
        <label class="radio-card">
          <input v-model="mode" type="radio" name="mode" value="translate" />
          <span>日语翻译成中文</span>
        </label>
      </fieldset>

      <button
        type="submit"
        class="button-primary button-block"
        :disabled="!selectedFile || isSubmitting"
        :aria-describedby="errorMessage ? 'submit-error' : undefined"
      >
        {{ isSubmitting ? "正在上传…" : "生成字幕" }}
      </button>

      <p v-if="errorMessage" id="submit-error" role="alert" class="error-text">
        {{ errorMessage }}
      </p>
      <p v-if="acceptedTask" class="success-text">
        已受理，任务编号：<span class="text-wrap">{{ acceptedTask.id }}</span>
      </p>
    </form>
  </section>

  <section class="panel" aria-label="任务记录">
    <div class="panel-head">
      <h2 class="panel-title">任务记录</h2>
      <button
        type="button"
        class="button button-small"
        :disabled="isRefreshing"
        @click="refreshNow"
      >
        {{ isRefreshing ? "刷新中…" : "刷新" }}
      </button>
    </div>

    <p v-if="offlineNotice" role="alert" class="error-text">{{ offlineNotice }}</p>
    <p v-if="isLoadingTasks" class="hint">正在加载任务…</p>
    <p v-else-if="!tasks.length" class="hint">暂无任务，请先提交音视频。</p>

    <ul class="task-list">
      <li v-for="task in tasks" :key="task.id">
        <SubtitleTaskCard :task="task" />
      </li>
    </ul>

    <nav class="pagination" aria-label="任务分页">
      <button
        type="button"
        class="button button-small"
        :disabled="isRefreshing || page <= 1"
        @click="goToPage(page - 1)"
      >
        上一页
      </button>
      <span class="hint">第 {{ page }} 页／共 {{ pageCount }} 页</span>
      <button
        type="button"
        class="button button-small"
        :disabled="isRefreshing || page >= pageCount"
        @click="goToPage(page + 1)"
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
const isLoadingTasks = ref(true);
const refreshDelay = ref(5000);

let refreshTimer: number | undefined;
let isDisposed = false;

const pageCount = computed(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

async function refreshTasks() {
  if (isRefreshing.value || isDisposed) return;

  isRefreshing.value = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }

  try {
    // 查询第一页，用它判断全局是否存在活动任务。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);

    // 用户查看历史页时，再查询对应分页。
    let visiblePage =
      page.value === 1
        ? firstPage
        : await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);

    // 记录过期导致当前页为空时，回到最后一个有效页。
    if (!visiblePage.tasks.length && visiblePage.total > 0 && page.value > 1) {
      const lastPage = Math.max(1, Math.ceil(visiblePage.total / PAGE_SIZE));
      page.value = lastPage;
      visiblePage = await fetchTaskList(PAGE_SIZE, (lastPage - 1) * PAGE_SIZE);
    }

    if (isDisposed) return;

    tasks.value = withAccepted(visiblePage.tasks);
    total.value = visiblePage.total;
    offlineNotice.value = "";
    isLoadingTasks.value = false;

    const hasActiveTasks = firstPage.tasks.some(
      (task) => task.status === "queued" || task.status === "running",
    );

    emit("active-change", hasActiveTasks);
    refreshDelay.value = hasActiveTasks ? 2000 : 5000;
  } catch (error) {
    // 失败时保留已有任务与活动状态，不自动重传。
    if (!isDisposed) {
      offlineNotice.value = `任务列表刷新失败（${describeApiError(error)}），已有记录已保留。`;
      isLoadingTasks.value = false;
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
  if (next < 1 || next > pageCount.value || next === page.value) return;
  page.value = next;
  void refreshTasks();
}

function showAccepted(task: SubtitleTask) {
  const exists = tasks.value.some((item) => item.id === task.id);
  tasks.value = exists
    ? tasks.value.map((item) => (item.id === task.id ? task : item))
    : [task, ...tasks.value];
  total.value = Math.max(total.value, tasks.value.length);
  emit("active-change", true);
}

function withAccepted(list: SubtitleTask[]): SubtitleTask[] {
  const accepted = acceptedTask.value;
  if (!accepted || page.value !== 1) return list;
  return list.some((item) => item.id === accepted.id)
    ? list
    : [accepted, ...list];
}

async function submit() {
  if (isSubmitting.value || !selectedFile.value) return;

  isSubmitting.value = true;
  errorMessage.value = "";
  try {
    const accepted = await submitSubtitle(selectedFile.value, mode.value);
    acceptedTask.value = accepted;
    // 保留处理方式、清空已提交文件，并切回第一页展示任务编号。
    mode.value = accepted.mode;
    selectedFile.value = null;
    page.value = 1;
    // 先本地展示：即使随后刷新失败，也不会出现“提交成功但任务消失”。
    showAccepted(accepted);
    refreshNow();
  } catch (error) {
    // 保留文件与模式，由用户决定是否再次提交；队列已满不自动重试。
    errorMessage.value = describeApiError(error);
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

<style scoped>
form {
  display: grid;
  gap: 16px;
}

.mode-group {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 8px;
}

.radio-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
}

.radio-card:hover {
  background: var(--surface-hover);
}

.radio-card input {
  accent-color: var(--accent);
}

.task-list {
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.task-list li {
  list-style: none;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}
</style>
