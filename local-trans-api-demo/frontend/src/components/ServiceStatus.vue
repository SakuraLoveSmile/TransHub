<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus } from "../api";
import type { ServiceStatus as ServiceStatusInfo } from "../types";

type ConnectionState = "connecting" | "online" | "offline";

const connectionState = ref<ConnectionState>("connecting");
const status = ref<ServiceStatusInfo | null>(null);

let refreshTimer: number | undefined;
let refreshRequest: Promise<void> | null = null;
let isDisposed = false;

function clearRefreshTimer() {
  if (refreshTimer === undefined) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
}

function scheduleRefresh() {
  if (isDisposed) return;
  clearRefreshTimer();
  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refresh();
  }, 5000);
}

async function refresh(): Promise<void> {
  if (isDisposed) return;
  if (refreshRequest) return refreshRequest;

  clearRefreshTimer();
  refreshRequest = (async () => {
    try {
      const isHealthy = await checkHealth();
      if (isDisposed) return;
      if (!isHealthy) {
        if (!isDisposed) {
          connectionState.value = "offline";
          status.value = null;
        }
        return;
      }

      const nextStatus = await fetchServiceStatus();
      if (isDisposed) return;
      status.value = nextStatus;
      connectionState.value = "online";
    } catch {
      if (!isDisposed) {
        connectionState.value = "offline";
        // Do not leave stale values that look like a live service.
        status.value = null;
      }
    }
  })().finally(() => {
    refreshRequest = null;
    if (!isDisposed) scheduleRefresh();
  });

  return refreshRequest;
}

function connectionLabel(): string {
  if (connectionState.value === "connecting") return "正在连接";
  if (connectionState.value === "online") return "已连接";
  return "服务离线";
}

function engineStatusLabel(value: string | undefined): string {
  if (value === "running") return "处理中";
  if (value === "idle") return "空闲";
  return "未知";
}

onMounted(() => {
  isDisposed = false;
  void refresh();
});

onUnmounted(() => {
  isDisposed = true;
  clearRefreshTimer();
});
</script>

<template>
  <section class="status-bar" aria-labelledby="service-status-heading">
    <div class="status-summary">
      <span
        class="connection-dot"
        :data-state="connectionState"
        aria-hidden="true"
      />
      <strong id="service-status-heading">{{ connectionLabel() }}</strong>
      <span v-if="connectionState === 'online' && status">
        {{ status.mock ? "模拟环境" : "真实推理" }}
      </span>
      <span v-if="connectionState === 'online' && status && status.device">
        {{ status.device.toUpperCase() }}
      </span>
    </div>

    <dl v-if="connectionState === 'online' && status" class="status-details">
      <div class="status-detail">
        <dt>运行模式</dt>
        <dd>{{ status.mock ? "Mock" : "真实推理" }}</dd>
      </div>
      <div class="status-detail">
        <dt>设备</dt>
        <dd>{{ status.device || "未知" }}</dd>
      </div>
      <div class="status-detail">
        <dt>当前模型</dt>
        <dd>{{ status.loaded_model || "未加载" }}</dd>
      </div>
      <div class="status-detail">
        <dt>引擎状态</dt>
        <dd>{{ engineStatusLabel(status.status) }}</dd>
      </div>
    </dl>

    <p v-if="connectionState === 'connecting'" class="status-connecting" role="status">
      正在连接 TransHub 服务…
    </p>
    <p v-else-if="connectionState === 'offline'" class="status-help" role="alert">
      服务离线，请先启动 TransHub（默认地址 127.0.0.1:8765）；服务会自动重试连接。
    </p>
  </section>
</template>
