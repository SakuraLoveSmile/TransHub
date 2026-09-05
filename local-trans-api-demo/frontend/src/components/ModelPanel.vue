<template>
  <section class="panel" aria-label="模型管理">
    <div class="panel-head">
      <h2 class="panel-title">模型管理</h2>
      <button
        type="button"
        class="button button-small"
        :disabled="isLoading"
        @click="refresh"
      >
        刷新状态
      </button>
    </div>

    <p v-if="errorMessage" role="alert" class="error-text">{{ errorMessage }}</p>
    <p v-if="isLoading" class="hint">正在加载模型列表…</p>
    <p v-else-if="!models.length && !errorMessage" class="hint">暂无可用模型</p>

    <ul class="model-list">
      <li v-for="model in models" :key="model.id" class="model">
        <div class="model-info">
          <strong>{{ model.name }}</strong>
          <span class="hint">{{ model.id }}</span>
          <span v-if="model.loaded" class="badge badge-success">已加载</span>
          <span v-else-if="model.installed" class="badge">已安装</span>
          <span v-else class="badge badge-danger">未安装</span>
          <span v-if="model.mock" class="badge badge-warning">模拟（Mock）</span>
        </div>
        <div class="actions">
          <button
            v-if="!model.installed"
            type="button"
            class="button button-small"
            :disabled="isBusy || hasActiveTasks"
            @click="download(model.id)"
          >
            {{ labelFor(model.id, "download", "下载") }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            type="button"
            class="button button-small"
            :disabled="isBusy || hasActiveTasks"
            @click="load(model.id)"
          >
            {{ labelFor(model.id, "load", "加载") }}
          </button>
          <button
            v-if="model.loaded"
            type="button"
            class="button button-small"
            :disabled="isBusy || hasActiveTasks"
            @click="unload(model.id)"
          >
            {{ labelFor(model.id, "unload", "卸载") }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有未完成字幕任务时禁用手动加载／卸载，任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="progress">
      <p class="hint">
        正在下载 {{ progress.model_id || "模型" }}（进行中）：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}
        <span v-if="progress.total_bytes">
          ／共 {{ formatBytes(progress.total_bytes) }}
        </span>
        <span v-else>（总大小未知，仅显示已下载字节数）</span>
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      />
    </div>

    <p v-else-if="progress.state === 'done'" class="success-text">
      下载完成，模型列表已刷新。
    </p>

    <p v-else-if="progress.state === 'failed'" role="alert" class="error-text">
      下载失败：{{ progress.error || "未知原因" }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  describeApiError,
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
  type DownloadProgress,
  type ModelInfo,
} from "../api";

defineProps<{ hasActiveTasks: boolean }>();

type PendingAction = "load" | "unload" | "download";
const PENDING_LABELS: Record<PendingAction, string> = {
  load: "加载中…",
  unload: "卸载中…",
  download: "下载请求中…",
};

const models = ref<ModelInfo[]>([]);
const isLoading = ref(true);
const errorMessage = ref("");
const progress = ref<DownloadProgress>({ state: "idle" });
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);

let timer: number | undefined;
let isPolling = false;
let isDisposed = false;

const isBusy = computed(() => pendingModelId.value !== null);

function labelFor(
  modelId: string,
  action: PendingAction,
  idleLabel: string,
): string {
  if (pendingModelId.value === modelId && pendingAction.value === action) {
    return PENDING_LABELS[action];
  }
  return idleLabel;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function loadModels() {
  isLoading.value = models.value.length === 0;
  try {
    progress.value = await fetchDownloadProgress();
    models.value = await fetchModels();
    if (isDisposed) return;
    errorMessage.value = "";
  } catch (error) {
    if (!isDisposed) {
      errorMessage.value = describeApiError(error);
      models.value = [];
    }
  } finally {
    isLoading.value = false;
  }
}

async function refresh() {
  if (isPolling || isDisposed) return;
  isPolling = true;
  if (timer !== undefined) {
    window.clearTimeout(timer);
  }
  try {
    await loadModels();
  } finally {
    isPolling = false;
    if (!isDisposed) {
      timer = window.setTimeout(() => void refresh(), 5000);
    }
  }
}

async function runAction(
  modelId: string,
  action: PendingAction,
  request: () => Promise<void>,
) {
  if (pendingModelId.value !== null) return;
  // 立即置忙，避免快速点击产生重复请求。
  pendingModelId.value = modelId;
  pendingAction.value = action;
  errorMessage.value = "";
  try {
    await request();
    await loadModels();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    if (!isDisposed) {
      pendingModelId.value = null;
      pendingAction.value = null;
    }
  }
}

function download(modelId: string) {
  void runAction(modelId, "download", () => startModelDownload(modelId));
}

function load(modelId: string) {
  void runAction(modelId, "load", () => loadModel(modelId));
}

function unload(modelId: string) {
  void runAction(modelId, "unload", () => unloadModel());
}

onMounted(() => {
  void refresh();
});

onUnmounted(() => {
  isDisposed = true;
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
});
</script>

<style scoped>
.model-list {
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.model {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
}

.model-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.progress {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

progress {
  width: 100%;
  accent-color: var(--accent);
}
</style>
