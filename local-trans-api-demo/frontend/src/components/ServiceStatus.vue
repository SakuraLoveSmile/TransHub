<template>
  <section class="panel status-bar" aria-label="服务状态">
    <p v-if="phase === 'connecting'" class="status-line" role="status">
      <span class="chip chip-warning">正在连接</span>
      <span class="text-hint">正在读取本机服务状态…</span>
    </p>

    <p v-else-if="phase === 'offline'" class="status-line" role="alert">
      <span class="chip chip-danger">已离线</span>
      <span class="text-alert">{{ offlineDetail }}</span>
    </p>

    <div v-else class="status-line" role="status">
      <span class="chip chip-success">已连接</span>
      <span class="chip">{{ status?.mock ? "模拟模式（Mock）" : "真实推理" }}</span>
      <span v-if="status?.device" class="chip">设备 {{ status.device }}</span>
      <span class="chip">当前模型 {{ status?.loaded_model ?? "未加载" }}</span>
      <span class="chip" :class="engineChipClass">引擎{{ engineLabel }}</span>
    </div>

    <p v-if="phase === 'offline'" class="text-hint offline-hint">
      请在本机启动 TransHub 服务（默认 127.0.0.1:8765），页面会自动重连。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

type Phase = "connecting" | "online" | "offline";

const phase = ref<Phase>("connecting");
const status = ref<ServiceStatus | null>(null);
const offlineDetail = ref("");

let refreshTimer: number | undefined;
let isRefreshing = false;
let isDisposed = false;

const engineLabel = computed(() => {
  const value = status.value?.status;
  if (value === "running") return "处理中";
  if (value === "idle") return "空闲";
  return "未知";
});

const engineChipClass = computed(() => {
  const value = status.value?.status;
  if (value === "running") return "chip-accent";
  if (value === "idle") return "chip-success";
  return "chip-warning";
});

async function refresh() {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  try {
    const healthy = await checkHealth();
    if (!healthy) {
      // 离线时丢弃上一次结果，避免看起来仍然在线。
      phase.value = "offline";
      status.value = null;
      offlineDetail.value = "健康检查失败，服务未响应。";
      return;
    }
    try {
      status.value = await fetchServiceStatus();
      phase.value = "online";
      offlineDetail.value = "";
    } catch (error) {
      phase.value = "offline";
      status.value = null;
      offlineDetail.value =
        error instanceof Error ? error.message : "状态接口请求失败。";
    }
  } finally {
    isRefreshing = false;
    if (!isDisposed) {
      refreshTimer = window.setTimeout(() => void refresh(), 5000);
    }
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

<style scoped>
.status-bar {
  padding: 14px 20px;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
}

.offline-hint {
  margin: 8px 0 0;
}
</style>
