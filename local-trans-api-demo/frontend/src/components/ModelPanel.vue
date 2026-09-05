<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  describeApiError,
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
} from "../api";
import type { DownloadProgress, ModelInfo } from "../api";

const props = defineProps<{ hasActiveTasks: boolean }>();

type PendingAction = "load" | "unload" | "download";

const models = ref<ModelInfo[]>([]);
const errorMessage = ref("");
const isLoading = ref(false);
const hasFetched = ref(false);
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<PendingAction | null>(null);
const progress = ref<DownloadProgress>({ state: "idle" });

let timer: number | undefined;
let isDisposed = false;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function stateLabel(model: ModelInfo): string {
  if (model.loaded) return "已加载";
  if (model.installed) return "已安装";
  return "未安装";
}

function stateBadgeClass(model: ModelInfo): string {
  if (model.loaded) return "badge--loaded";
  if (model.installed) return "badge--installed";
  return "badge--missing";
}

function downloadLabel(model: ModelInfo): string {
  if (pendingModelId.value === model.id && pendingAction.value === "download") {
    return "下载请求中…";
  }
  if (progress.value.state === "running" && progress.value.model_id === model.id) {
    return "下载中…";
  }
  return "下载";
}

function loadLabel(model: ModelInfo): string {
  return pendingModelId.value === model.id && pendingAction.value === "load"
    ? "加载中…"
    : "加载";
}

function unloadLabel(model: ModelInfo): string {
  return pendingModelId.value === model.id && pendingAction.value === "unload"
    ? "卸载中…"
    : "卸载";
}

function isDownloadDisabled(model: ModelInfo): boolean {
  return (
    props.hasActiveTasks ||
    pendingAction.value !== null ||
    (progress.value.state === "running" && progress.value.model_id === model.id)
  );
}

function isActionDisabled(): boolean {
  return props.hasActiveTasks || pendingAction.value !== null;
}

async function refresh() {
  if (isDisposed) return;
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  isLoading.value = !hasFetched.value;
  try {
    const list = await fetchModels();
    const prog = await fetchDownloadProgress();
    if (isDisposed) return;
    models.value = list;
    progress.value = prog;
    errorMessage.value = "";
    hasFetched.value = true;
  } catch (error) {
    if (!isDisposed) errorMessage.value = describeApiError(error);
  } finally {
    isLoading.value = false;
    if (!isDisposed) scheduleNext();
  }
}

function scheduleNext() {
  if (isDisposed) return;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => void refresh(), 5000);
}

async function download(modelId: string) {
  if (pendingAction.value || props.hasActiveTasks) return;
  // 发起下载前立即设置忙碌状态，避免快速点击产生重复请求。
  pendingModelId.value = modelId;
  pendingAction.value = "download";
  errorMessage.value = "";
  try {
    await startModelDownload(modelId);
    await refresh();
  } catch (error) {
    // 失败保留错误说明。
    errorMessage.value = describeApiError(error);
  } finally {
    pendingAction.value = null;
    pendingModelId.value = null;
  }
}

async function load(modelId: string) {
  if (pendingAction.value || props.hasActiveTasks) return;
  pendingModelId.value = modelId;
  pendingAction.value = "load";
  errorMessage.value = "";
  try {
    await loadModel(modelId);
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingAction.value = null;
    pendingModelId.value = null;
  }
}

async function unload(modelId: string) {
  if (pendingAction.value || props.hasActiveTasks) return;
  pendingModelId.value = modelId;
  pendingAction.value = "unload";
  errorMessage.value = "";
  try {
    await unloadModel();
    await refresh();
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingAction.value = null;
    pendingModelId.value = null;
  }
}

onMounted(() => {
  isDisposed = false;
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

<template>
  <section class="panel" aria-label="模型管理">
    <div class="panel-head">
      <h2 class="panel__title">模型管理</h2>
      <button
        type="button"
        class="button-ghost"
        :disabled="isLoading"
        @click="refresh"
      >
        {{ isLoading ? "刷新中…" : "刷新状态" }}
      </button>
    </div>

    <p v-if="isLoading && !hasFetched" class="hint">正在加载模型列表…</p>
    <p v-if="errorMessage" role="alert" class="notice notice--error">
      {{ errorMessage }}
    </p>
    <p v-if="hasFetched && !models.length && !errorMessage" class="hint">
      暂无可用模型。
    </p>

    <ul class="model-list">
      <li v-for="model in models" :key="model.id" class="model">
        <div class="model__info">
          <strong class="model__name">{{ model.name }}</strong>
          <span class="model__id">{{ model.id }}</span>
          <span class="badge" :class="stateBadgeClass(model)">
            {{ stateLabel(model) }}
          </span>
        </div>

        <div class="model__actions">
          <button
            v-if="!model.installed"
            type="button"
            class="button-ghost"
            :disabled="isDownloadDisabled(model)"
            @click="download(model.id)"
          >
            {{ downloadLabel(model) }}
          </button>
          <button
            v-if="model.installed && !model.loaded"
            type="button"
            class="button-ghost"
            :disabled="isActionDisabled()"
            @click="load(model.id)"
          >
            {{ loadLabel(model) }}
          </button>
          <button
            v-if="model.loaded"
            type="button"
            class="button-ghost"
            :disabled="isActionDisabled()"
            @click="unload(model.id)"
          >
            {{ unloadLabel(model) }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有活动字幕任务时禁用手动加载／卸载，任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="progress">
      <p class="progress__text">
        正在下载 {{ progress.model_id }}：已下载
        {{ formatBytes(progress.downloaded_bytes ?? 0) }}
        <template v-if="progress.total_bytes">
          ／共 {{ formatBytes(progress.total_bytes) }}
        </template>
        <template v-else>（总大小未知，下载进行中）</template>
      </p>
      <progress
        v-if="progress.total_bytes"
        class="progress__bar"
        :value="progress.downloaded_bytes ?? 0"
        :max="progress.total_bytes"
      />
    </div>

    <p v-if="progress.state === 'failed'" role="alert" class="notice notice--error">
      下载失败：{{ progress.error || "未知原因" }}
    </p>
  </section>
</template>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.panel__title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.model {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}

.model:first-child {
  border-top: 0;
}

.model__info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.model__name {
  font-size: 14px;
}

.model__id {
  color: var(--muted);
  font-size: 12px;
  word-break: break-all;
}

.badge {
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.badge--loaded {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
}

.badge--installed {
  color: var(--muted);
}

.badge--missing {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
}

.model__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.hint {
  margin: 8px 0;
  color: var(--muted);
  font-size: 13px;
}

.notice {
  margin: 8px 0;
  font-size: 13px;
}

.notice--error {
  color: var(--danger);
}

.progress {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.progress__text {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
}

.progress__bar {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  accent-color: var(--accent);
}

.button-ghost {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.button-ghost:hover:not(:disabled) {
  background: var(--surface-hover);
}
</style>
