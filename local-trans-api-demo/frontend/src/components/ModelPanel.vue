<template>
  <section class="panel" aria-labelledby="models-title">
    <h2 id="models-title">模型管理</h2>

    <p v-if="showInitialLoading" class="hint">正在加载模型列表…</p>
    <p v-if="errorMessage" role="alert" class="error-text">{{ errorMessage }}</p>
    <p v-else-if="hasLoaded && !models.length" class="hint">暂无可用模型。</p>

    <ul v-if="models.length" class="model-list">
      <li v-for="model in models" :key="model.id" class="model-item">
        <div class="model-info">
          <strong class="model-name">{{ model.name }}</strong>
          <span class="model-id">{{ model.id }}</span>
          <span>
            <span v-if="model.loaded" class="badge badge-status-succeeded">已加载</span>
            <span v-else-if="model.installed" class="badge">已安装</span>
            <span v-else class="badge badge-status-failed">未安装</span>
            <span v-if="model.mock" class="badge badge-mock">Mock</span>
          </span>
        </div>
        <div class="model-actions">
          <button
            v-if="!model.installed"
            type="button"
            class="button-secondary"
            :disabled="isModelActionDisabled(model)"
            @click="download(model.id)"
          >
            {{ downloadLabel(model) }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            type="button"
            class="button-secondary"
            :disabled="isBusy || hasActiveTasks"
            @click="load(model.id)"
          >
            {{ loadLabel(model) }}
          </button>
          <button
            v-if="model.loaded"
            type="button"
            class="button-secondary"
            :disabled="isBusy || hasActiveTasks"
            @click="unload(model.id)"
          >
            {{ unloadLabel(model) }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有活动字幕任务时不能手动加载或卸载模型；任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="download-progress">
      <p v-if="progress.total_bytes">
        正在下载 {{ progress.model_id }}：{{
          formatBytes(progress.downloaded_bytes ?? 0)
        }}
        / {{ formatBytes(progress.total_bytes) }}（{{ downloadPercent }}%）
      </p>
      <p v-else>
        正在下载 {{ progress.model_id }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}（总大小未知，下载进行中）
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      />
    </div>

    <p v-if="progress.state === 'failed'" role="alert" class="download-error">
      <span class="error-text">下载失败：{{ progress.error || "未知原因" }}</span>
      <button type="button" class="button-secondary" @click="refreshNow">
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

const props = defineProps<{ hasActiveTasks: boolean }>();

type PendingAction = "load" | "unload" | "download";

const IDLE_DELAY_MS = 5000;
const DOWNLOAD_DELAY_MS = 2000;

const models = ref<ModelInfo[]>([]);
const hasLoaded = ref(false);
const errorMessage = ref("");
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);
const progress = ref<DownloadProgress>({ state: "idle" });

let timer: number | undefined;
let isRefreshing = false;
let isDisposed = false;

const isBusy = computed(() => pendingAction.value !== null);
const showInitialLoading = computed(
  () => !hasLoaded.value && !errorMessage.value,
);

const downloadPercent = computed(() => {
  const totalBytes = progress.value.total_bytes;
  if (!totalBytes) return 0;
  return Math.min(
    100,
    Math.floor(((progress.value.downloaded_bytes ?? 0) / totalBytes) * 100),
  );
});

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function downloadLabel(model: ModelInfo): string {
  if (pendingAction.value === "download" && pendingModelId.value === model.id) {
    return "下载请求中…";
  }
  if (progress.value.state === "running" && progress.value.model_id === model.id) {
    return "下载中…";
  }
  return "下载";
}

function loadLabel(model: ModelInfo): string {
  return pendingAction.value === "load" && pendingModelId.value === model.id
    ? "加载中…"
    : "加载";
}

function unloadLabel(model: ModelInfo): string {
  return pendingAction.value === "unload" && pendingModelId.value === model.id
    ? "卸载中…"
    : "卸载";
}

function isModelActionDisabled(model: ModelInfo): boolean {
  if (isBusy.value || props.hasActiveTasks) return true;
  return (
    progress.value.state === "running" && progress.value.model_id === model.id
  );
}

async function refresh() {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;

  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }

  try {
    // 列表与进度一起取：下载完成的那一帧模型列表同步刷新为“已安装”。
    const [list, currentProgress] = await Promise.all([
      fetchModels(),
      fetchDownloadProgress(),
    ]);
    if (isDisposed) return;
    models.value = list;
    progress.value = currentProgress;
    hasLoaded.value = true;
    errorMessage.value = "";
  } catch (error) {
    if (!isDisposed) {
      errorMessage.value = describeApiError(error);
    }
  } finally {
    isRefreshing = false;
    if (!isDisposed) {
      const delay =
        progress.value.state === "running" ? DOWNLOAD_DELAY_MS : IDLE_DELAY_MS;
      timer = window.setTimeout(() => void refresh(), delay);
    }
  }
}

function refreshNow() {
  void refresh();
}

async function download(modelId: string) {
  // 发起下载前立即设置忙碌状态，避免快速点击产生重复请求。
  if (isBusy.value || props.hasActiveTasks) return;
  pendingAction.value = "download";
  pendingModelId.value = modelId;
  errorMessage.value = "";

  try {
    await startModelDownload(modelId);
    await refresh();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    pendingAction.value = null;
    pendingModelId.value = null;
  }
}

async function load(modelId: string) {
  if (isBusy.value || props.hasActiveTasks) return;
  pendingAction.value = "load";
  pendingModelId.value = modelId;
  errorMessage.value = "";

  try {
    await loadModel(modelId);
    await refresh();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    pendingAction.value = null;
    pendingModelId.value = null;
  }
}

async function unload(modelId: string) {
  if (isBusy.value || props.hasActiveTasks) return;
  pendingAction.value = "unload";
  pendingModelId.value = modelId;
  errorMessage.value = "";

  try {
    await unloadModel();
    await refresh();
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    pendingAction.value = null;
    pendingModelId.value = null;
  }
}

onMounted(() => {
  void refresh();
});

onUnmounted(() => {
  isDisposed = true;
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>
