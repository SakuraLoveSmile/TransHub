<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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

const file = ref<File | null>(null);
const mode = ref<SubtitleMode>("transcribe");
const isSubmitting = ref(false);
const submitError = ref("");
const acceptedTaskId = ref("");

const tasks = ref<SubtitleTask[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 20;

const offlineNotice = ref("");
const refreshDelay = ref(5000);

let refreshTimer: number | undefined;
let isRefreshing = false;
let isDisposed = false;

async function refreshTasks() {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }

  try {
    const firstPage = await fetchTaskList(limit, 0);
    
    let visiblePage = firstPage;
    if (page.value > 1) {
      // 记录过期导致当前页为空时，回到最后一个有效页。
      const maxPage = Math.max(1, Math.ceil(firstPage.total / limit));
      if (page.value > maxPage) {
        page.value = maxPage;
      }
      if (page.value > 1) {
        visiblePage = await fetchTaskList(limit, (page.value - 1) * limit);
      }
    }

    if (isDisposed) return;

    tasks.value = visiblePage.tasks;
    total.value = visiblePage.total;
    offlineNotice.value = "";

    const hasActiveTasks = firstPage.tasks.some(
      (task) => task.status === "queued" || task.status === "running"
    );

    emit("active-change", hasActiveTasks);
    refreshDelay.value = hasActiveTasks ? 2000 : 5000;
  } catch (error) {
    if (!isDisposed) {
      offlineNotice.value = `任务列表刷新失败（${describeApiError(error)}），已有记录已保留。`;
    }
  } finally {
    isRefreshing = false;
    if (!isDisposed) {
      refreshTimer = window.setTimeout(
        () => void refreshTasks(),
        refreshDelay.value
      );
    }
  }
}

async function submit() {
  if (isSubmitting.value || !file.value) return;
  
  isSubmitting.value = true;
  submitError.value = "";
  acceptedTaskId.value = "";

  try {
    const task = await submitSubtitle(file.value, mode.value);
    acceptedTaskId.value = task.id;
    file.value = null; // 清空文件，保留模式
    page.value = 1; // 切回第一页
    
    // 提交成功后安排一次刷新
    if (refreshTimer !== undefined) {
      window.clearTimeout(refreshTimer);
    }
    void refreshTasks();
  } catch (error) {
    submitError.value = describeApiError(error);
  } finally {
    isSubmitting.value = false;
  }
}

function changePage(newPage: number) {
  if (isRefreshing) return;
  page.value = newPage;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }
  void refreshTasks();
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

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
  <div class="panel create-panel" aria-label="创建字幕">
    <h2>创建字幕</h2>
    <form @submit.prevent="submit">
      <MediaFilePicker v-model="file" :disabled="isSubmitting" />

      <div class="mode-selection">
        <label>处理方式</label>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" v-model="mode" value="transcribe" :disabled="isSubmitting" />
            日语转录
          </label>
          <label class="radio-label">
            <input type="radio" v-model="mode" value="translate" :disabled="isSubmitting" />
            日语翻译成中文
          </label>
        </div>
      </div>

      <button type="submit" class="button-primary submit-btn" :disabled="!file || isSubmitting">
        {{ isSubmitting ? "正在上传…" : "生成字幕" }}
      </button>

      <p v-if="submitError" role="alert" class="error-msg">{{ submitError }}</p>
      <p v-if="acceptedTaskId" class="success-msg">
        已受理，任务编号：{{ acceptedTaskId }}
      </p>
    </form>
  </div>

  <div class="panel tasks-panel" aria-label="任务记录">
    <div class="tasks-header">
      <h2>任务记录</h2>
      <button type="button" class="refresh-btn" :disabled="isRefreshing" @click="refreshTasks">
        刷新
      </button>
    </div>

    <p v-if="offlineNotice" role="alert" class="error-msg">{{ offlineNotice }}</p>
    
    <div v-if="!tasks.length && !offlineNotice" class="empty-state">
      暂无任务，请先提交音视频。
    </div>

    <div class="task-list">
      <SubtitleTaskCard v-for="task in tasks" :key="task.id" :task="task" />
    </div>

    <div class="pagination" v-if="total > 0">
      <button 
        type="button" 
        :disabled="page <= 1 || isRefreshing" 
        @click="changePage(page - 1)"
      >
        上一页
      </button>
      <span class="page-info">第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
      <button 
        type="button" 
        :disabled="page >= totalPages || isRefreshing" 
        @click="changePage(page + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin-top: 0;
  margin-bottom: 20px;
  font-size: 18px;
  font-weight: 600;
}

form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.mode-selection label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--muted);
}

.radio-group {
  display: flex;
  gap: 16px;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text) !important;
  margin-bottom: 0 !important;
}

.submit-btn {
  margin-top: 8px;
}

.error-msg {
  color: var(--danger);
  font-size: 14px;
  margin: 0;
}

.success-msg {
  color: var(--success);
  font-size: 14px;
  margin: 0;
}

.tasks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.tasks-header h2 {
  margin: 0;
}

.refresh-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.refresh-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.empty-state {
  color: var(--muted);
  text-align: center;
  padding: 40px 0;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.pagination button {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
}
.pagination button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.page-info {
  font-size: 14px;
  color: var(--muted);
}
</style>
