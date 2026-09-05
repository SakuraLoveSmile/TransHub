<template>
  <section class="panel" aria-label="模型管理">
    <h2>模型管理</h2>
    <p v-if="errorMessage" role="alert" class="error">{{ errorMessage }}</p>
    <p v-if="loading" role="status" class="hint">正在加载模型列表…</p>
    <p v-else-if="!models.length && !errorMessage" class="hint">
      暂无可用模型
    </p>
    <ul v-else>
      <li v-for="model in models" :key="model.id" class="model">
        <div>
          <strong>{{ model.name }}</strong>
          <span class="mid">{{ model.id }}</span>
          <span v-if="model.loaded" class="loaded">已加载</span>
          <span v-else-if="model.installed" class="installed">已安装</span>
          <span v-else class="missing">未安装</span>
        </div>
        <div class="actions">
          <button
            v-if="!model.installed"
            :disabled="isBusy || hasActiveTasks"
            @click="download(model.id)"
          >
            {{ isPending(model.id, "download") ? "下载中…" : "下载" }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            :disabled="isBusy || hasActiveTasks"
            @click="load(model.id)"
          >
            {{ isPending(model.id, "load") ? "加载中…" : "加载" }}
          </button>
          <button
            v-if="model.loaded"
            :disabled="isBusy || hasActiveTasks"
            @click="unload(model.id)"
          >
            {{ isPending(model.id, "unload") ? "卸载中…" : "卸载" }}
          </button>
        </div>
      </li>
    </ul>
    <p v-if="hasActiveTasks" class="hint">
      有未完成字幕任务时禁用手动下载／加载／卸载，任务会自动加载所需模型，完成后可再手动切换。
    </p>
    <div v-if="progress.state === 'running'" class="progress">
      <p v-if="progress.total_bytes">
        正在下载 {{ progress.model_id }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }} ／ 共
        {{ formatBytes(progress.total_bytes) }}（{{
          downloadPercent
        }}％，进行中）
      </p>
      <p v-else>
        正在下载 {{ progress.model_id }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}
        （总大小未知，进行中，不显示百分比）
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      />
    </div>
    <p v-if="progress.state === 'failed'" role="alert" class="error">
      下载失败：{{ progress.error || "未知原因" }}
      <button @click="refresh">刷新状态</button>
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

type PendingAction = "download" | "load" | "unload";

defineProps<{ hasActiveTasks: boolean }>();

const models = ref<ModelInfo[]>([]);
const errorMessage = ref("");
const loading = ref(true);
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);
const progress = ref<DownloadProgress>({ state: "idle" });
let refreshing = false;
let disposed = false;

const isBusy = computed(() => pendingAction.value !== null);

const downloadPercent = computed(() => {
  const done = progress.value.downloaded_bytes ?? 0;
  const total = progress.value.total_bytes ?? 0;
  if (!total || total <= 0) return "0";
  return Math.min(100, Math.floor((done / total) * 100)).toString();
});

function isPending(modelId: string, action: PendingAction): boolean {
  return pendingModelId.value === modelId && pendingAction.value === action;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    models.value = await fetchModels();
    progress.value = await fetchDownloadProgress();
    errorMessage.value = "";
  } catch (error) {
    // 列表刷新失败保留旧模型与旧错误可见，不清空已有数据。
    errorMessage.value = describeApiError(error);
  } finally {
    refreshing = false;
    loading.value = false;
  }
}

async function download(modelId: string) {
  // 前置忙态防止重复点击导致重复下载请求。
  if (pendingAction.value !== null) return;
  pendingModelId.value = modelId;
  pendingAction.value = "download";
  errorMessage.value = "";
  try {
    await startModelDownload(modelId);
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingAction.value = null;
  }
}

async function load(modelId: string) {
  if (pendingAction.value !== null) return;
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

async function unload(modelId: string) {
  if (pendingAction.value !== null) return;
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

async function pollLoop() {
  while (!disposed) {
    await refresh();
    await sleep(5000);
  }
}

onMounted(() => {
  disposed = false;
  void pollLoop();
});

onUnmounted(() => {
  disposed = true;
});
</script>

<style scoped>
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius, 10px);
  padding: 16px;
  margin-bottom: 0;
}
ul {
  padding: 0;
  margin: 0;
}
.model {
  list-style: none;
  border-top: 1px solid var(--border-soft);
  padding: 8px 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.mid {
  font-size: 12px;
  color: var(--muted);
  margin-left: 8px;
}
.loaded,
.installed,
.missing {
  font-size: 12px;
  border-radius: 4px;
  padding: 2px 6px;
  margin-left: 8px;
  border: 1px solid transparent;
}
.loaded {
  color: var(--success);
  background: var(--success-bg);
  border-color: rgba(67, 199, 131, 0.4);
}
.installed {
  color: var(--info);
  background: var(--info-bg);
  border-color: rgba(111, 195, 255, 0.35);
}
.missing {
  color: var(--muted);
  background: var(--neutral-bg);
  border-color: var(--border);
}
.actions {
  display: flex;
  gap: 8px;
}
.error {
  color: var(--danger);
  background: var(--danger-bg);
  border: 1px solid rgba(255, 122, 122, 0.4);
  border-radius: 8px;
  padding: 8px 10px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
}
.progress {
  margin-top: 8px;
}
.progress p {
  font-size: 13px;
  color: var(--text);
  margin: 0 0 8px;
}
progress {
  width: 100%;
}
</style>
