<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  describeApiError,
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
} from "../api";
import type { DownloadProgress, ModelInfo } from "../types";

const props = defineProps<{ hasActiveTasks: boolean }>();

type ModelAction = "load" | "unload" | "download";

const models = ref<ModelInfo[]>([]);
const progress = ref<DownloadProgress>({ state: "idle" });
const errorMessage = ref("");
const isLoading = ref(true);
const isRefreshing = ref(false);
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<ModelAction | null>(null);

let refreshTimer: number | undefined;
let refreshRequest: Promise<void> | null = null;
let isDisposed = false;

const isActionPending = computed(() => pendingAction.value !== null);

function clearRefreshTimer() {
  if (refreshTimer === undefined) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
}

function scheduleRefresh() {
  if (isDisposed) return;
  clearRefreshTimer();
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refreshStatus();
  }, 5000);
}

async function refreshStatus(): Promise<void> {
  if (isDisposed) return;
  if (refreshRequest) return refreshRequest;

  clearRefreshTimer();
  isRefreshing.value = true;
  refreshRequest = (async () => {
    try {
      const [nextModels, nextProgress] = await Promise.all([
        fetchModels(),
        fetchDownloadProgress(),
      ]);
      if (isDisposed) return;
      models.value = nextModels;
      progress.value = nextProgress;
      errorMessage.value = "";
    } catch (error) {
      if (!isDisposed) errorMessage.value = describeApiError(error);
    }
  })().finally(() => {
    refreshRequest = null;
    if (isDisposed) return;
    isLoading.value = false;
    isRefreshing.value = false;
    scheduleRefresh();
  });

  return refreshRequest;
}

function refreshButton() {
  if (isRefreshing.value) return;
  void refreshStatus();
}

function isPending(modelId: string, action: ModelAction): boolean {
  return pendingModelId.value === modelId && pendingAction.value === action;
}

function isModelBusy(modelId: string): boolean {
  return pendingModelId.value === modelId;
}

async function download(modelId: string) {
  if (props.hasActiveTasks || isActionPending.value) return;
  pendingModelId.value = modelId;
  pendingAction.value = "download";
  errorMessage.value = "";
  try {
    await startModelDownload(modelId);
    await refreshStatus();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    if (!isDisposed) {
      pendingModelId.value = null;
      pendingAction.value = null;
    }
  }
}

async function load(modelId: string) {
  if (props.hasActiveTasks || isActionPending.value) return;
  pendingModelId.value = modelId;
  pendingAction.value = "load";
  errorMessage.value = "";
  try {
    await loadModel(modelId);
    await refreshStatus();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    if (!isDisposed) {
      pendingModelId.value = null;
      pendingAction.value = null;
    }
  }
}

async function unload() {
  if (props.hasActiveTasks || isActionPending.value) return;
  pendingModelId.value = "__loaded_model__";
  pendingAction.value = "unload";
  errorMessage.value = "";
  try {
    await unloadModel();
    await refreshStatus();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    if (!isDisposed) {
      pendingModelId.value = null;
      pendingAction.value = null;
    }
  }
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function modelState(model: ModelInfo): { label: string; state: string } {
  if (model.loaded) return { label: "已加载", state: "loaded" };
  if (model.installed) return { label: "已安装", state: "installed" };
  return { label: "未安装", state: "missing" };
}

function downloadLabel(model: ModelInfo): string {
  if (isPending(model.id, "download")) return "下载请求中…";
  if (progress.value.state === "running" && progress.value.model_id === model.id) {
    return "下载中…";
  }
  return "下载";
}

function progressDescription(): string {
  const downloaded = formatBytes(progress.value.downloaded_bytes);
  if (progress.value.total_bytes && progress.value.total_bytes > 0) {
    return `已下载 ${downloaded} / ${formatBytes(progress.value.total_bytes)}`;
  }
  return `已下载 ${downloaded} · 总大小未知，下载进行中`;
}

onMounted(() => {
  isDisposed = false;
  void refreshStatus();
});

onUnmounted(() => {
  isDisposed = true;
  clearRefreshTimer();
});
</script>

<template>
  <section class="panel model-panel" aria-labelledby="model-panel-heading">
    <header class="model-panel-header">
      <div>
        <p class="panel-kicker">RUNTIME</p>
        <h2 id="model-panel-heading">模型管理</h2>
      </div>
      <button
        class="button-quiet"
        type="button"
        :disabled="isRefreshing"
        @click="refreshButton"
      >
        {{ isRefreshing ? "刷新中…" : "刷新状态" }}
      </button>
    </header>

    <p v-if="isLoading" class="model-empty" role="status">
      正在加载模型状态…
    </p>
    <p v-else-if="!models.length" class="model-empty">
      暂无可用模型
    </p>
    <ul v-else class="model-list">
      <li v-for="model in models" :key="model.id" class="model-entry">
        <div>
          <strong class="model-name">{{ model.name }}</strong>
          <p class="model-id">{{ model.id }}</p>
          <span
            class="model-state"
            :data-state="modelState(model).state"
          >
            {{ modelState(model).label }}
          </span>
        </div>
        <div class="model-actions">
          <button
            v-if="!model.installed"
            type="button"
            :disabled="hasActiveTasks || isActionPending || isModelBusy(model.id) || progress.state === 'running'"
            @click="void download(model.id)"
          >
            {{ downloadLabel(model) }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            type="button"
            :disabled="hasActiveTasks || isActionPending || isModelBusy(model.id)"
            @click="void load(model.id)"
          >
            {{ isPending(model.id, "load") ? "加载中…" : "加载" }}
          </button>
          <button
            v-if="model.loaded"
            type="button"
            :disabled="hasActiveTasks || isActionPending"
            @click="void unload()"
          >
            {{ isPending("__loaded_model__", "unload") ? "卸载中…" : "卸载" }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="model-hint">
      当前有活动字幕任务，手动加载、卸载和下载已暂停；任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="model-progress" role="status">
      <p>
        正在下载 {{ progress.model_id || "模型" }}：{{ progressDescription() }}
      </p>
      <progress
        v-if="progress.total_bytes && progress.total_bytes > 0"
        :value="Math.min(progress.downloaded_bytes || 0, progress.total_bytes)"
        :max="progress.total_bytes"
        aria-label="模型下载进度"
      />
    </div>
    <p v-if="progress.state === 'done'" class="model-hint" role="status">
      模型下载完成，刷新状态后即可加载。
    </p>
    <p v-if="progress.state === 'failed'" class="model-error" role="alert">
      下载失败：{{ progress.error || "未知原因" }}
    </p>
    <p v-if="errorMessage" class="model-error" role="alert">
      {{ errorMessage }}
    </p>
  </section>
</template>
