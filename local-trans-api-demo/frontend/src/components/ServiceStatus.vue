<template>
  <section
    class="status-bar"
    :class="`is-${connectionState}`"
    aria-label="服务状态"
    :aria-busy="connectionState === 'connecting'"
  >
    <p class="status-summary">
      <span class="status-dot" aria-hidden="true"></span>
      <span>{{ summaryText }}</span>
    </p>

    <ul v-if="connectionState === 'online' && status" class="status-details">
      <li>
        <span class="label">模式</span>
        <span>{{ status.mock ? "模拟模式（Mock）" : "真实推理" }}</span>
      </li>
      <li>
        <span class="label">设备</span>
        <span>{{ status.device ?? "—" }}</span>
      </li>
      <li>
        <span class="label">当前模型</span>
        <span>{{ status.loaded_model ?? "未加载" }}</span>
      </li>
      <li>
        <span class="label">引擎状态</span>
        <span>{{ engineStateText }}</span>
      </li>
    </ul>

    <p v-else-if="connectionState === 'offline'" role="alert" class="status-offline-hint">
      无法连接服务。请先在本机启动 TransHub（run.bat 或真实推理用
      run-real.bat，默认 127.0.0.1:8765）；若真实服务启动失败，请查看
      run-real.bat 控制台输出。页面会自动重连。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

type ConnectionState = "connecting" | "online" | "offline";

const POLL_DELAY_MS = 5000;

const connectionState = ref<ConnectionState>("connecting");
const status = ref<ServiceStatus | null>(null);

let timer: number | undefined;
let isRefreshing = false;
let isDisposed = false;

const summaryText = computed(() => {
  if (connectionState.value === "connecting") return "正在连接服务…";
  if (connectionState.value === "online") return "已连接";
  return "服务离线";
});

const engineStateText = computed(() => {
  const value = status.value?.status;
  if (value === "running") return "处理中";
  if (value === "idle") return "空闲";
  return "未知";
});

async function refresh() {
  if (isRefreshing || isDisposed) return;
  isRefreshing = true;

  try {
    const healthy = await checkHealth();
    if (isDisposed) return;

    if (!healthy) {
      // 离线时清掉旧状态，避免页面看起来仍然在线。
      connectionState.value = "offline";
      status.value = null;
      return;
    }

    try {
      const next = await fetchServiceStatus();
      if (isDisposed) return;
      status.value = next;
      connectionState.value = "online";
    } catch {
      if (isDisposed) return;
      connectionState.value = "offline";
      status.value = null;
    }
  } finally {
    isRefreshing = false;
    if (!isDisposed) {
      timer = window.setTimeout(() => void refresh(), POLL_DELAY_MS);
    }
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
