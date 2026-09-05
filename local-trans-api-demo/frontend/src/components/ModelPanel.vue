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

const models = ref<ModelInfo[]>([]);
const isLoading = ref(true);
const errorMessage = ref("");
const downloadNotice = ref("");
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);
const progress = ref<DownloadProgress>({ state: "idle" });

let refreshTimer: number | undefined;
let isRefreshing = false;
let isDisposed = false;
let previousProgressState = "idle";

const isDownloading = computed(() => progress.value.state === "running");

const isBusy = computed(
  () => isDownloading.value || pendingModelId.value !== null,
);

const downloadPercent = computed(() => {
  const total = progress.value.total_bytes;
  const downloaded = progress.value.downloaded_bytes;
  if (!total || downloaded === undefined) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
});

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function scheduleRefresh(delay: number): void {
  if (isDisposed) return;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = window.setTimeout(() => void refresh(), delay);
}

async function refresh(): Promise<void> {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  try {
    const nextProgress = await fetchDownloadProgress();
    const justFinished =
      previousProgressState === "running" && nextProgress.state === "done";
    previousProgressState = nextProgress.state;
    progress.value = nextProgress;

    // 下载完成后模型列表会多出“已安装”的模型，立即重新读取。
    models.value = await fetchModels();
    errorMessage.value = "";

    if (justFinished) {
      downloadNotice.value = "模型下载完成，已刷新模型列表。";
    }

    if (pendingAction.value === "download" && nextProgress.state !== "running") {
      pendingModelId.value = null;
      pendingAction.value = null;
    }
  } catch (error) {
    if (!isDisposed) {
      errorMessage.value = describeApiError(error);
    }
  } finally {
    isLoading.value = false;
    isRefreshing = false;
    if (!isDisposed) {
      scheduleRefresh(isDownloading.value ? 1000 : 5000);
    }
  }
}

async function download(modelId: string): Promise<void> {
  // 发起下载前立即占位，避免快速点击产生重复请求。
  if (pendingModelId.value !== null || isDownloading.value) return;
  pendingModelId.value = modelId;
  pendingAction.value = "download";
  errorMessage.value = "";
  downloadNotice.value = "";

  try {
    await startModelDownload(modelId);
    previousProgressState = "running";
  } catch (error) {
    errorMessage.value = describeApiError(error);
    pendingModelId.value = null;
    pendingAction.value = null;
    return;
  }

  await refresh();
}

async function load(modelId: string): Promise<void> {
  if (pendingModelId.value !== null) return;
  pendingModelId.value = modelId;
  pendingAction.value = "load";
  errorMessage.value = "";

  try {
    await loadModel(modelId);
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingAction.value = null;
  }
}

async function unload(modelId: string): Promise<void> {
  if (pendingModelId.value !== null) return;
  pendingModelId.value = modelId;
  pendingAction.value = "unload";
  errorMessage.value = "";

  try {
    await unloadModel();
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingAction.value = null;
  }
}

onMounted(() => {
  isDisposed = false;
  void refresh();
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
  <section class="panel panel-models" aria-label="模型管理">
    <h2>模型管理</h2>

    <p v-if="errorMessage" role="alert" class="message-alert">
      {{ errorMessage }}
    </p>
    <p v-if="downloadNotice" role="status" class="message-status">
      {{ downloadNotice }}
    </p>

    <p v-if="isLoading" class="text-hint">正在加载模型列表…</p>
    <p v-else-if="!models.length" class="text-hint">暂无可用模型。</p>

    <ul class="model-list">
      <li v-for="model in models" :key="model.id" class="model">
        <div class="model-head">
          <strong class="break-anywhere">{{ model.name }}</strong>
          <span class="text-hint model-id break-anywhere">{{ model.id }}</span>
        </div>

        <div class="model-foot">
          <span
            class="chip"
            :class="{
              'chip-success': model.loaded,
              'chip-accent': model.installed && !model.loaded,
              'chip-warning': !model.installed,
            }"
          >
            {{ model.loaded ? "已加载" : model.installed ? "已安装" : "未安装" }}
          </span>
          <span v-if="model.mock" class="chip">模拟</span>

          <div class="model-actions">
            <button
              v-if="!model.installed"
              type="button"
              class="button-secondary"
              :disabled="props.hasActiveTasks || isBusy"
              @click="download(model.id)"
            >
              {{
                pendingAction === "download" && pendingModelId === model.id
                  ? "下载请求中…"
                  : "下载"
              }}
            </button>
            <button
              v-if="model.installed && !model.loaded"
              type="button"
              class="button-secondary"
              :disabled="props.hasActiveTasks || isBusy"
              @click="load(model.id)"
            >
              {{
                pendingAction === "load" && pendingModelId === model.id
                  ? "加载中…"
                  : "加载"
              }}
            </button>
            <button
              v-if="model.loaded"
              type="button"
              class="button-secondary"
              :disabled="props.hasActiveTasks || isBusy"
              @click="unload(model.id)"
            >
              {{
                pendingAction === "unload" && pendingModelId === model.id
                  ? "卸载中…"
                  : "卸载"
              }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <p v-if="props.hasActiveTasks" class="text-hint">
      有进行中的字幕任务时不能手动加载或卸载模型，任务会自动加载所需模型。
    </p>

    <div v-if="isDownloading" class="progress">
      <p class="text-hint">
        正在下载 {{ progress.model_id || "模型" }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}
        <template v-if="progress.total_bytes">
          ／共 {{ formatBytes(progress.total_bytes) }}（{{
            downloadPercent
          }}%）
        </template>
        <template v-else>（总大小未知，进行中）</template>
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      ></progress>
    </div>

    <p v-if="progress.state === 'failed'" class="message-alert" role="alert">
      下载失败：{{ progress.error || "未知原因" }}
      <button type="button" class="button-secondary" @click="refresh">
        刷新状态
      </button>
    </p>
  </section>
</template>

<style scoped>
.model-list {
  margin: 0;
  padding: 0;
}

.model {
  list-style: none;
  display: grid;
  gap: 10px;
  padding: 14px 0;
  border-top: 1px solid var(--border);
}

.model:first-child {
  border-top: 0;
  padding-top: 0;
}

.model-head {
  display: grid;
  gap: 2px;
}

.model-id {
  font-size: 12px;
}

.model-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.model-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
}

.progress {
  margin-top: 12px;
}

.progress progress {
  width: 100%;
}
</style>
