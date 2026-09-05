<template>
  <section class="status-bar" aria-label="服务状态">
    <template v-if="phase === 'connecting'">
      <span class="status-dot connecting" aria-hidden="true"></span>
      <span class="status-value">正在连接…</span>
    </template>

    <template v-else-if="phase === 'online' && status">
      <span class="status-dot online" aria-hidden="true"></span>
      <span class="status-value">已连接</span>
      <span class="status-item">
        <span class="status-label">模式</span>
        <span>{{ status.mock ? "模拟（Mock）" : "真实推理" }}</span>
      </span>
      <span class="status-item">
        <span class="status-label">设备</span>
        <span>{{ status.device ?? "未知" }}</span>
      </span>
      <span class="status-item">
        <span class="status-label">当前模型</span>
        <span>{{ status.loaded_model ?? "未加载" }}</span>
      </span>
      <span class="status-item">
        <span class="status-label">引擎状态</span>
        <span>{{ engineLabel }}</span>
      </span>
    </template>

    <template v-else>
      <span class="status-dot offline" aria-hidden="true"></span>
      <span class="status-offline">服务离线</span>
      <span class="hint">
        请启动 TransHub 服务（run-real.bat），连接恢复后这里会自动更新。
      </span>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

const POLL_INTERVAL = 5000;

type Phase = "connecting" | "online" | "offline";

const phase = ref<Phase>("connecting");
const status = ref<ServiceStatus | null>(null);
let timer: number | undefined;
let disposed = false;

const engineLabel = computed(() => {
  if (status.value?.status === "running") return "处理中";
  if (status.value?.status === "idle") return "空闲";
  return "未知";
});

async function refresh() {
  const ok = await checkHealth();
  if (disposed) return;
  if (!ok) {
    // 离线时清空旧状态，避免保留看起来仍然在线的数据。
    phase.value = "offline";
    status.value = null;
    return;
  }
  try {
    const next = await fetchServiceStatus();
    if (disposed) return;
    status.value = next;
    phase.value = "online";
  } catch {
    if (disposed) return;
    phase.value = "offline";
    status.value = null;
  }
}

// 串行轮询：上一次请求完成后才安排下一次，卸载时清理定时器。
async function refreshLoop() {
  await refresh();
  if (disposed) return;
  timer = window.setTimeout(() => void refreshLoop(), POLL_INTERVAL);
}

onMounted(() => {
  disposed = false;
  void refreshLoop();
});

onUnmounted(() => {
  disposed = true;
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
});
</script>
