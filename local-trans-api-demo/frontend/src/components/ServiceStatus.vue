<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

const isConnecting = ref(true);
const connected = ref(false);
const status = ref<ServiceStatus | null>(null);

let refreshTimer: number | undefined;
let isRefreshing = false;
let isDisposed = false;

function translateEngineStatus(s: string | undefined): string {
  if (s === "running") return "处理中";
  if (s === "idle") return "空闲";
  return "未知";
}

async function refreshStatus() {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;

  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }

  try {
    const ok = await checkHealth();
    if (!ok) {
      connected.value = false;
      status.value = null;
    } else {
      const newStatus = await fetchServiceStatus();
      if (!isDisposed) {
        status.value = newStatus;
        connected.value = true;
      }
    }
  } catch {
    if (!isDisposed) {
      connected.value = false;
      status.value = null;
    }
  } finally {
    isConnecting.value = false;
    isRefreshing = false;

    if (!isDisposed) {
      refreshTimer = window.setTimeout(
        () => void refreshStatus(),
        5000
      );
    }
  }
}

onMounted(() => {
  isDisposed = false;
  void refreshStatus();
});

onUnmounted(() => {
  isDisposed = true;
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
});
</script>

<template>
  <section class="compact-status" aria-label="服务状态">
    <div class="status-content">
      <template v-if="isConnecting">
        <span class="dot dot-connecting"></span>
        <span class="status-text">正在连接...</span>
      </template>
      
      <template v-else-if="!connected">
        <span class="dot dot-offline"></span>
        <span class="status-text offline-text">服务离线</span>
        <span class="status-detail">请确认 TransHub 已启动（127.0.0.1:8765），若真实服务无法启动，请查看 run-real.bat 控制台输出。</span>
      </template>
      
      <template v-else>
        <span class="dot dot-online"></span>
        <span class="status-text">已连接</span>
        
        <div class="status-items" v-if="status">
          <span class="item" v-if="status.mock"><span class="badge mock">模拟模式</span></span>
          <span class="item" v-else><span class="badge">真实推理</span></span>
          
          <span class="item">设备: {{ status.device ?? "—" }}</span>
          <span class="item">当前模型: {{ status.loaded_model ?? "未加载" }}</span>
          <span class="item">状态: {{ translateEngineStatus(status.status) }}</span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.compact-status {
  padding: 16px 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  align-items: center;
}

.status-content {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.dot-connecting {
  background: var(--warning);
}

.dot-offline {
  background: var(--danger);
}

.dot-online {
  background: var(--success);
}

.status-text {
  font-weight: 600;
}

.offline-text {
  color: var(--danger);
}

.status-detail {
  color: var(--muted);
}

.status-items {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-left: 8px;
  padding-left: 16px;
  border-left: 1px solid var(--border);
}

.item {
  color: var(--text);
}

.badge {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.badge.mock {
  background: rgba(252, 211, 77, 0.1);
  color: var(--warning);
  border: 1px solid rgba(252, 211, 77, 0.2);
}
</style>
