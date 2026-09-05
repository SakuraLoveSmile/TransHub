<template>
  <section class="panel panel-model" aria-label="模型管理">
    <h2 class="panel-title">模型管理</h2>

    <p v-if="isListLoading" role="status" class="hint">正在加载模型列表…</p>
    <p v-else-if="errorMessage" role="alert" class="alert-error">{{ errorMessage }}</p>
    <p v-else-if="!models.length" class="hint">暂无可用模型。</p>

    <ul v-else class="model-list">
      <li v-for="model in models" :key="model.id" class="model-item">
        <div class="model-meta">
          <span class="model-name">{{ model.name }}</span>
          <span class="model-id">{{ model.id }}</span>
        </div>
        <span
          v-if="model.loaded"
          class="badge badge-success"
        >已加载</span>
        <span
          v-else-if="model.installed"
          class="badge"
        >已安装</span>
        <span
          v-else
          class="badge badge-warning"
        >未安装</span>
        <div class="model-actions">
          <button
            v-if="!model.installed"
            type="button"
            class="button-small"
            :disabled="hasPending || hasActiveTasks || isDownloadRunning"
            @click="download(model.id)"
          >
            {{ isPending(model.id, "download") ? "下载请求中…" : "下载" }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            type="button"
            class="button-small"
            :disabled="hasPending || hasActiveTasks"
            @click="load(model.id)"
          >
            {{ isPending(model.id, "load") ? "加载中…" : "加载" }}
          </button>
          <button
            v-if="model.loaded"
            type="button"
            class="button-small"
            :disabled="hasPending || hasActiveTasks"
            @click="unload(model.id)"
          >
            {{ isPending(model.id, "unload") ? "卸载中…" : "卸载" }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有进行中的字幕任务，模型操作已暂停；任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="download-progress">
      <p class="hint">
        正在下载 {{ progress.model_id ?? "模型" }}：
        <template v-if="progress.total_bytes">
          已下载 {{ formatBytes(progress.downloaded_bytes ?? 0) }} ／ 共
          {{ formatBytes(progress.total_bytes) }}
        </template>
        <template v-else>
          已下载 {{ formatBytes(progress.downloaded_bytes ?? 0) }}，总大小未知
        </template>
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      ></progress>
      <p v-else class="hint">下载进行中…</p>
    </div>

    <p v-if="progress.state === 'failed'" role="alert" class="alert-error">
      下载失败：{{ progress.error || "未知原因" }}
      <button type="button" class="button-small" @click="refreshStatus">
        刷新状态
      </button>
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

const POLL_INTERVAL = 5000;

type PendingAction = "load" | "unload" | "download";

const props = defineProps<{ hasActiveTasks: boolean }>();

const models = ref<ModelInfo[]>([]);
const isListLoading = ref(true);
const errorMessage = ref("");
const progress = ref<DownloadProgress>({ state: "idle" });

const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);

let timer: number | undefined;
let disposed = false;

const hasPending = computed(() => pendingModelId.value !== null);
const isDownloadRunning = computed(() => progress.value.state === "running");

function isPending(modelId: string, action: PendingAction): boolean {
  return pendingModelId.value === modelId && pendingAction.value === action;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function refresh() {
  try {
    const list = await fetchModels();
    const downloadProgress = await fetchDownloadProgress();
    if (disposed) return;
    models.value = list;
    progress.value = downloadProgress;
    isListLoading.value = false;
    errorMessage.value = "";
  } catch (error) {
    if (disposed) return;
    isListLoading.value = false;
    errorMessage.value = describeApiError(error);
  }
}

// 串行轮询：上一次完成后才安排下一次，卸载时清理定时器。
async function refreshLoop() {
  await refresh();
  if (disposed) return;
  timer = window.setTimeout(() => void refreshLoop(), POLL_INTERVAL);
}

function setPending(modelId: string, action: PendingAction) {
  pendingModelId.value = modelId;
  pendingAction.value = action;
}

function clearPending() {
  pendingModelId.value = null;
  pendingAction.value = null;
}

async function download(modelId: string) {
  if (hasPending.value) return;
  // 发起请求前立即置忙，避免快速点击产生重复请求。
  setPending(modelId, "download");
  errorMessage.value = "";
  try {
    await startModelDownload(modelId);
    await refresh();
  } catch (error) {
    if (!disposed) errorMessage.value = describeApiError(error);
  } finally {
    clearPending();
  }
}

async function load(modelId: string) {
  if (hasPending.value) return;
  setPending(modelId, "load");
  errorMessage.value = "";
  try {
    await loadModel(modelId);
    await refresh();
  } catch (error) {
    if (!disposed) errorMessage.value = describeApiError(error);
  } finally {
    clearPending();
  }
}

async function unload(modelId: string) {
  if (hasPending.value) return;
  setPending(modelId, "unload");
  errorMessage.value = "";
  try {
    await unloadModel();
    await refresh();
  } catch (error) {
    if (!disposed) errorMessage.value = describeApiError(error);
  } finally {
    clearPending();
  }
}

function refreshStatus() {
  void refresh();
}

onMounted(() => {
  disposed = false;
  void refreshLoop();
});

onUnmounted(() => {
  disposed = true;
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
});
</script>
