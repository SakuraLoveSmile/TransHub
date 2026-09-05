<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
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

const models = ref<ModelInfo[]>([]);
const isListLoading = ref(true);
const errorMessage = ref("");
const progress = ref<DownloadProgress>({ state: "idle" });

type PendingOp = "load" | "unload" | "download";
const pendingModelId = ref<string | null>(null);
const pendingOp = ref<PendingOp | null>(null);

let timer: number | undefined;
let disposed = false;
let isRefreshing = false;

function isPending(modelId: string, op: PendingOp): boolean {
  return pendingModelId.value === modelId && pendingOp.value === op;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function refresh() {
  if (isRefreshing || disposed) return;
  isRefreshing = true;
  try {
    const nextModels = await fetchModels();
    const nextProgress = await fetchDownloadProgress();
    if (disposed) return;
    models.value = nextModels;
    progress.value = nextProgress;
    errorMessage.value = "";
  } catch (error) {
    if (!disposed) errorMessage.value = describeApiError(error);
  } finally {
    isRefreshing = false;
    if (!disposed) isListLoading.value = false;
  }
}

async function load(modelId: string) {
  if (pendingOp.value) return;
  pendingModelId.value = modelId;
  pendingOp.value = "load";
  errorMessage.value = "";
  try {
    await loadModel(modelId);
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingOp.value = null;
  }
}

async function unload(modelId: string) {
  if (pendingOp.value) return;
  pendingModelId.value = modelId;
  pendingOp.value = "unload";
  errorMessage.value = "";
  try {
    await unloadModel();
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingOp.value = null;
  }
}

async function download(modelId: string) {
  if (pendingOp.value) return;
  // 发起下载前立即设置忙碌状态，避免快速点击产生重复请求。
  pendingModelId.value = modelId;
  pendingOp.value = "download";
  errorMessage.value = "";
  try {
    await startModelDownload(modelId);
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingOp.value = null;
  }
}

function opLabel(modelId: string, op: PendingOp, idle: string): string {
  if (!isPending(modelId, op)) return idle;
  if (op === "load") return "加载中…";
  if (op === "unload") return "卸载中…";
  return "下载请求中…";
}

onMounted(() => {
  disposed = false;
  void refresh();
  timer = window.setInterval(() => void refresh(), 5000);
});

onUnmounted(() => {
  disposed = true;
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <section class="panel panel-model" aria-label="模型管理">
    <h2>模型管理</h2>

    <p v-if="isListLoading" role="status" class="hint">正在加载模型列表…</p>
    <p v-else-if="!models.length" class="task-empty">暂无可用模型。</p>

    <p v-if="errorMessage" role="alert" class="error-text">{{ errorMessage }}</p>

    <ul v-if="models.length" class="model-list">
      <li v-for="model in models" :key="model.id" class="model-item">
        <div class="model-info">
          <strong class="model-name">{{ model.name }}</strong>
          <span class="model-id">{{ model.id }}</span>
          <span
            class="badge"
            :class="model.loaded ? 'succeeded' : model.installed ? '' : 'failed'"
            style="margin-left: 8px"
          >{{ model.loaded ? "已加载" : model.installed ? "已安装" : "未安装" }}</span>
        </div>
        <div class="actions">
          <button
            v-if="!model.installed"
            :disabled="pendingOp !== null || hasActiveTasks"
            @click="download(model.id)"
          >
            {{ opLabel(model.id, "download", "下载") }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            :disabled="pendingOp !== null || hasActiveTasks"
            @click="load(model.id)"
          >
            {{ opLabel(model.id, "load", "加载") }}
          </button>
          <button
            v-if="model.loaded"
            :disabled="pendingOp !== null || hasActiveTasks"
            @click="unload(model.id)"
          >
            {{ opLabel(model.id, "unload", "卸载") }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有未完成的字幕任务时暂停手动加载／卸载，任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="progress-block">
      <p>
        正在下载 {{ progress.model_id }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}
        <template v-if="progress.total_bytes">
          ／共 {{ formatBytes(progress.total_bytes) }}
        </template>
        <template v-else>（总大小未知，下载进行中）</template>
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      ></progress>
    </div>

    <div v-if="progress.state === 'failed'" class="progress-block">
      <p role="alert" class="error-text">
        下载失败：{{ progress.error || "未知原因" }}
      </p>
      <button type="button" @click="refresh">刷新状态</button>
    </div>

    <p v-if="progress.state === 'done'" class="success-text">
      模型下载完成，列表已更新。
    </p>
  </section>
</template>