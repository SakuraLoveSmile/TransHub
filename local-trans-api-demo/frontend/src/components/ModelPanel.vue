<template>
  <section class="panel" aria-label="模型管理">
    <h2>模型管理</h2>
    <p v-if="errorMessage" role="alert" class="error">{{ errorMessage }}</p>

    <p v-if="loading" role="status" class="hint">正在加载模型列表…</p>
    <p v-else-if="!models.length && !errorMessage" class="hint">
      暂无可用模型
    </p>

    <ul v-else class="model-list">
      <li v-for="model in models" :key="model.id" class="model">
        <div class="model-info">
          <strong>{{ model.name }}</strong>
          <span class="muted-text mid">{{ model.id }}</span>
          <span v-if="model.loaded" class="chip chip-success">已加载</span>
          <span v-else-if="model.installed" class="chip chip-info">已安装</span>
          <span v-else class="chip chip-neutral">未安装</span>
        </div>
        <div class="actions">
          <button
            v-if="!model.installed"
            type="button"
            class="button-ghost"
            :disabled="isBusy || hasActiveTasks"
            @click="download(model.id)"
          >
            {{ isPending(model.id, "download") ? "下载请求中…" : "下载" }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            type="button"
            class="button-ghost"
            :disabled="isBusy || hasActiveTasks"
            @click="load(model.id)"
          >
            {{ isPending(model.id, "load") ? "加载中…" : "加载" }}
          </button>
          <button
            v-if="model.loaded"
            type="button"
            class="button-ghost"
            :disabled="isBusy || hasActiveTasks"
            @click="unload(model.id)"
          >
            {{ isPending(model.id, "unload") ? "卸载中…" : "卸载" }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有未完成字幕任务时禁用手动加载／卸载／下载；任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="progress">
      <p class="muted-text">
        正在下载 {{ progress.model_id }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}
        <template v-if="progress.total_bytes">
          ／共 {{ formatBytes(progress.total_bytes) }}（{{
            downloadPercent
          }}%，进行中）
        </template>
        <template v-else>（总大小未知，进行中，不显示百分比）</template>
      </p>
      <progress
        v-if="progress.total_bytes"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      />
    </div>

    <p v-if="progress.state === 'failed'" role="alert" class="error">
      下载失败：{{ progress.error || "未知原因" }}
      <button type="button" class="button-ghost" @click="refresh">
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

type PendingAction = "download" | "load" | "unload";

defineProps<{ hasActiveTasks: boolean }>();

const models = ref<ModelInfo[]>([]);
const errorMessage = ref("");
const loading = ref(true);
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);
const progress = ref<DownloadProgress>({ state: "idle" });
const refreshing = ref(false);
const isDisposed = ref(false);
let timer: number | undefined;

const isBusy = computed(() => pendingAction.value !== null);

const downloadPercent = computed(() => {
  const done = progress.value.downloaded_bytes ?? 0;
  const total = progress.value.total_bytes ?? 0;
  if (!total || total <= 0) return "0";
  return Math.min(100, Math.floor((done / total) * 100)).toString();
});

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function isPending(modelId: string, action: PendingAction): boolean {
  return pendingModelId.value === modelId && pendingAction.value === action;
}

async function refresh() {
  if (refreshing.value || isDisposed.value) return;
  refreshing.value = true;
  try {
    models.value = await fetchModels();
    progress.value = await fetchDownloadProgress();
    errorMessage.value = "";
  } catch (error) {
    // 列表刷新失败保留旧模型列表与旧错误，不静默清空。
    errorMessage.value = describeApiError(error);
  } finally {
    refreshing.value = false;
    loading.value = false;
  }
}

async function download(modelId: string) {
  // 发起前立即置忙，避免快速点击产生重复下载请求。
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

function schedule() {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(
    () =>
      void (async () => {
        await refresh();
        if (!isDisposed.value) schedule();
      })(),
    5000,
  );
}

onMounted(() => {
  isDisposed.value = false;
  void refresh();
  schedule();
});

onUnmounted(() => {
  isDisposed.value = true;
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>

<style scoped>
.model-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.model {
  border-top: 1px solid var(--border-soft);
  padding: 10px 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.model:first-child {
  border-top: 0;
  padding-top: 0;
}

.model-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.mid {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.error {
  margin: 8px 0;
}

.error button {
  margin-left: 8px;
}

.hint {
  margin: 10px 0 0;
}

.progress {
  margin-top: 10px;
}

.progress p {
  margin: 0 0 8px;
}
</style>
