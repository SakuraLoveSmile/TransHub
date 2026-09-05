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

defineProps<{ hasActiveTasks: boolean }>();

const models = ref<ModelInfo[]>([]);
const errorMessage = ref("");
const isLoadingModels = ref(true);

type ActionType = 'download' | 'load' | 'unload' | null;
const pendingModelId = ref<string | null>(null);
const pendingAction = ref<ActionType>(null);

const progress = ref<DownloadProgress>({ state: "idle" });
let timer: number | undefined;
let isDisposed = false;
let isRefreshing = false;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function refresh(silent = false) {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;
  
  if (!silent) isLoadingModels.value = true;
  
  try {
    const fetchedModels = await fetchModels();
    if (isDisposed) return;
    models.value = fetchedModels;
    
    const fetchedProgress = await fetchDownloadProgress();
    if (isDisposed) return;
    
    // 如果之前正在下载，现在下载完了，清除下载状态，不清除错误
    if (progress.value.state === "running" && fetchedProgress.state !== "running") {
      if (pendingAction.value === 'download') {
        pendingModelId.value = null;
        pendingAction.value = null;
      }
    }
    
    progress.value = fetchedProgress;
    errorMessage.value = "";
  } catch (error) {
    if (!isDisposed) {
      errorMessage.value = describeApiError(error);
    }
  } finally {
    if (!isDisposed) {
      isLoadingModels.value = false;
      isRefreshing = false;
    }
  }
}

async function download(modelId: string) {
  if (pendingAction.value || pendingModelId.value) return;
  
  errorMessage.value = "";
  pendingModelId.value = modelId;
  pendingAction.value = 'download';
  
  try {
    await startModelDownload(modelId);
    await refresh(true);
  } catch (error) {
    errorMessage.value = describeApiError(error);
    pendingModelId.value = null;
    pendingAction.value = null;
  }
}

async function load(modelId: string) {
  if (pendingAction.value || pendingModelId.value) return;
  
  errorMessage.value = "";
  pendingModelId.value = modelId;
  pendingAction.value = 'load';
  
  try {
    await loadModel(modelId);
    await refresh(true);
  } catch (error) {
    errorMessage.value = describeApiError(error);
  } finally {
    pendingModelId.value = null;
    pendingAction.value = null;
  }
}

async function unload(modelId: string) {
  if (pendingAction.value || pendingModelId.value) return;
  
  errorMessage.value = "";
  pendingModelId.value = modelId;
  pendingAction.value = 'unload';
  
  try {
    await unloadModel();
    await refresh(true);
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
  timer = window.setInterval(() => void refresh(true), 5000);
});

onUnmounted(() => {
  isDisposed = true;
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <section class="panel" aria-label="模型管理">
    <h2>模型管理</h2>
    
    <p v-if="errorMessage" role="alert" class="error-msg">{{ errorMessage }}</p>
    
    <div v-if="isLoadingModels && models.length === 0" class="state-msg">
      正在加载模型列表…
    </div>
    <div v-else-if="models.length === 0" class="state-msg empty">
      暂无可用模型。
    </div>
    
    <ul v-else class="model-list">
      <li v-for="model in models" :key="model.id" class="model-item">
        <div class="model-info">
          <strong class="model-name">{{ model.name }}</strong>
          <span class="model-id">{{ model.id }}</span>
          
          <span v-if="model.loaded" class="badge loaded">已加载</span>
          <span v-else-if="model.installed" class="badge installed">已安装</span>
          <span v-else class="badge missing">未安装</span>
        </div>
        
        <div class="actions">
          <button
            v-if="!model.installed"
            class="action-btn"
            :disabled="hasActiveTasks || (pendingAction !== null && pendingModelId !== model.id) || (pendingModelId === model.id && pendingAction === 'download')"
            @click="download(model.id)"
          >
            {{ pendingModelId === model.id && pendingAction === 'download' ? "下载请求中…" : "下载" }}
          </button>
          
          <button
            v-if="model.installed && !model.loaded"
            class="action-btn"
            :disabled="hasActiveTasks || pendingAction !== null"
            @click="load(model.id)"
          >
            {{ pendingModelId === model.id && pendingAction === 'load' ? "加载中…" : "加载" }}
          </button>
          
          <button
            v-if="model.loaded"
            class="action-btn danger"
            :disabled="hasActiveTasks || pendingAction !== null"
            @click="unload(model.id)"
          >
            {{ pendingModelId === model.id && pendingAction === 'unload' ? "卸载中…" : "卸载" }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="hasActiveTasks" class="hint">
      有活动字幕任务时已禁用手动模型操作，任务会自动加载所需模型。
    </p>

    <div v-if="progress.state === 'running'" class="progress-box">
      <p class="progress-text">
        正在下载 {{ progress.model_id }}<br/>
        <span class="progress-detail">
          已下载 {{ formatBytes(progress.downloaded_bytes ?? 0) }}
          <template v-if="progress.total_bytes">
            ／共 {{ formatBytes(progress.total_bytes) }}
            （{{ Math.round(((progress.downloaded_bytes ?? 0) / progress.total_bytes) * 100) }}%）
          </template>
          <template v-else>
            （总大小未知，不显示百分比）
          </template>
        </span>
      </p>
      <div class="progress-bar-container" v-if="progress.total_bytes">
        <div 
          class="progress-bar-fill" 
          :style="{ width: `${Math.round(((progress.downloaded_bytes ?? 0) / progress.total_bytes) * 100)}%` }"
        ></div>
      </div>
      <div class="progress-bar-container indeterminate" v-else>
        <div class="progress-bar-fill"></div>
      </div>
    </div>

    <div v-if="progress.state === 'failed'" role="alert" class="error-box">
      <p class="error-msg">下载失败：{{ progress.error || "未知原因" }}</p>
      <button class="action-btn mt-2" @click="refresh(true)">刷新状态</button>
    </div>
  </section>
</template>

<style scoped>
h2 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 18px;
  font-weight: 600;
}

.model-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}

.model-item {
  border-top: 1px solid var(--border);
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.model-item:first-child {
  border-top: none;
}

.model-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.model-name {
  font-size: 15px;
}

.model-id {
  font-size: 13px;
  color: var(--muted);
}

.badge {
  font-size: 12px;
  border-radius: 4px;
  padding: 2px 6px;
}

.badge.loaded {
  background: rgba(110, 231, 183, 0.1);
  color: var(--success);
  border: 1px solid rgba(110, 231, 183, 0.2);
}

.badge.installed {
  background: rgba(165, 176, 194, 0.1);
  color: var(--muted);
}

.badge.missing {
  background: rgba(253, 164, 175, 0.1);
  color: var(--danger);
  border: 1px solid rgba(253, 164, 175, 0.2);
}

.actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.danger {
  color: var(--danger);
  border-color: rgba(253, 164, 175, 0.3);
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(253, 164, 175, 0.1);
}

.state-msg {
  color: var(--muted);
  font-size: 14px;
  padding: 20px 0;
  text-align: center;
}

.error-msg {
  color: var(--danger);
  font-size: 14px;
  margin: 0 0 12px 0;
}

.error-box {
  background: rgba(253, 164, 175, 0.1);
  border-left: 4px solid var(--danger);
  padding: 12px;
  border-radius: 4px;
  margin-top: 16px;
}

.mt-2 {
  margin-top: 8px;
}

.hint {
  font-size: 13px;
  color: var(--muted);
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border);
}

.progress-box {
  margin-top: 16px;
  padding: 12px;
  background: var(--surface-hover);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.progress-text {
  font-size: 14px;
  margin: 0 0 8px 0;
}

.progress-detail {
  font-size: 13px;
  color: var(--muted);
}

.progress-bar-container {
  height: 6px;
  background: var(--bg);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

.progress-bar-container.indeterminate .progress-bar-fill {
  width: 50%;
  position: absolute;
  animation: indeterminate-animation 1.5s infinite ease-in-out;
}

@keyframes indeterminate-animation {
  0% { left: -50%; }
  100% { left: 100%; }
}
</style>
