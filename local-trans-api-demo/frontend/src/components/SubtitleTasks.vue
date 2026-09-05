<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
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

const file = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const submitError = ref("");
const acceptedTask = ref<SubtitleTask | null>(null);

const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const offlineNotice = ref("");
const isRefreshing = ref(false);

let refreshTimer: number | undefined;
let isFetching = false;
let isDisposed = false;
let refreshDelay = 5000;

const totalPages = ref(1);

function modes(): Array<{ value: SubtitleMode; title: string; desc: string }> {
  return [
    { value: "transcribe", title: "日语转录", desc: "输出日语文本字幕" },
    { value: "translate", title: "日语翻译成中文", desc: "输出中文文本字幕" },
  ];
}

async function refreshTasks() {
  if (isFetching || isDisposed) return;

  isFetching = true;
  isRefreshing.value = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  try {
    // 查询第一页，用它判断全局是否存在活动任务。
    const firstPage = await fetchTaskList(PAGE_SIZE, 0);

    // 用户查看历史页时，再查询对应分页。
    const visiblePage =
      page.value === 1
        ? firstPage
        : await fetchTaskList(PAGE_SIZE, (page.value - 1) * PAGE_SIZE);

    if (isDisposed) return;

    let visible = visiblePage;
    if (!visible.tasks.length && visible.total > 0 && page.value > 1) {
      // 记录过期导致当前页为空时，回到最后一个有效页。
      const lastPage = Math.max(1, Math.ceil(visible.total / PAGE_SIZE));
      visible = await fetchTaskList(PAGE_SIZE, (lastPage - 1) * PAGE_SIZE);
      if (isDisposed) return;
      page.value = lastPage;
    }

    tasks.value = visible.tasks;
    total.value = visible.total;
    totalPages.value = Math.max(1, Math.ceil(visible.total / PAGE_SIZE));
    offlineNotice.value = "";

    const hasActiveTasks = firstPage.tasks.some(
      (task) => task.status === "queued" || task.status === "running",
    );

    emit("active-change", hasActiveTasks);
    refreshDelay = hasActiveTasks ? 2000 : 5000;
  } catch (error) {
    if (!isDisposed) {
      // 请求失败保留已有任务和活动状态，仅提示刷新失败。
      offlineNotice.value = `任务列表刷新失败（${describeApiError(error)}），已有记录已保留。`;
    }
  } finally {
    isFetching = false;
    isRefreshing.value = false;

    if (!isDisposed) {
      refreshTimer = window.setTimeout(
        () => void refreshTasks(),
        refreshDelay,
      );
    }
  }
}

async function submit() {
  if (isSubmitting.value || !file.value) return;
  isSubmitting.value = true;
  submitError.value = "";

  try {
    // 成功受理后保留处理方式，清空已提交文件，切回第一页并展示任务编号。
    acceptedTask.value = await submitSubtitle(file.value, mode.value);
    file.value = null;
    page.value = 1;
    totalPages.value = Math.max(totalPages.value, 1);
    void refreshTasks();
  } catch (error) {
    // 提交失败保留文件和模式，显示接口错误；队列已满时不自动重试。
    submitError.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
  }
}

function goToPage(next: number) {
  if (isRefreshing.value) return;
  if (next < 1 || (totalPages.value > 0 && next > totalPages.value)) return;
  page.value = next;
  void refreshTasks();
}

onMounted(() => {
  isDisposed = false;
  void refreshTasks();
});

onUnmounted(() => {
  isDisposed = true;
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
});
</script>

<template>
  <div class="display-contents">
    <section class="panel panel-create" aria-label="创建字幕">
      <h2>创建字幕</h2>

      <MediaFilePicker v-model="file" :disabled="isSubmitting" />

      <div class="panel-section">
        <fieldset class="mode-group" :disabled="isSubmitting">
          <legend class="hint">处理方式</legend>
          <label
            v-for="item in modes()"
            :key="item.value"
            class="mode-option"
            :class="{ selected: mode === item.value }"
          >
            <input
              v-model="mode"
              type="radio"
              name="subtitle-mode"
              :value="item.value"
            />
            <span>
              <span class="mode-title">{{ item.title }}</span><br />
              <span class="mode-desc">{{ item.desc }}</span>
            </span>
          </label>
        </fieldset>
      </div>

      <div class="panel-section">
        <button
          type="button"
          class="button-primary"
          :disabled="!file || isSubmitting"
          @click="submit"
        >
          {{ isSubmitting ? "正在上传…" : "生成字幕" }}
        </button>

        <p v-if="submitError" role="alert" class="error-text">
          {{ submitError }}
        </p>
        <p v-if="acceptedTask" role="status" class="success-text">
          已受理，任务编号：{{ acceptedTask.id }}
        </p>
      </div>
    </section>

    <section class="panel panel-tasks" aria-label="任务记录">
      <div class="tasks-header">
        <h2>任务记录</h2>
        <button
          type="button"
          :disabled="isRefreshing"
          @click="refreshTasks"
        >
          {{ isRefreshing ? "刷新中…" : "刷新" }}
        </button>
      </div>

      <p v-if="offlineNotice" role="alert" class="error-text">
        {{ offlineNotice }}
      </p>
      <p v-if="!tasks.length && !offlineNotice" class="task-empty">
        暂无任务，提交音视频后会显示在这里。
      </p>

      <ul class="task-list">
        <SubtitleTaskCard
          v-for="task in tasks"
          :key="task.id"
          :task="task"
        />
      </ul>

      <div v-if="totalPages > 1" class="pagination">
        <button
          type="button"
          :disabled="isRefreshing || page <= 1"
          @click="goToPage(page - 1)"
        >
          上一页
        </button>
        <span class="page-info">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button
          type="button"
          :disabled="isRefreshing || page >= totalPages"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>
      </div>
    </section>
  </div>
</template>