<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus } from "../api";
import type { ServiceStatus as ServiceStatusModel } from "../api";

type ConnectionState = "connecting" | "online" | "offline";

const connectionState = ref<ConnectionState>("connecting");
const status = ref<ServiceStatusModel | null>(null);

let timer: number | undefined;
let inFlight = false;
let isDisposed = false;

const connectionLabel = computed(() => {
  switch (connectionState.value) {
    case "online":
      return "已连接";
    case "offline":
      return "离线";
    default:
      return "正在连接";
  }
});

const engineStateLabel = computed(() => {
  const value = status.value?.status;
  if (value === "running") return "处理中";
  if (value === "idle") return "空闲";
  return "未知";
});

async function poll() {
  if (isDisposed || inFlight) return;
  inFlight = true;

  try {
    const ok = await checkHealth();
    if (isDisposed) return;

    if (!ok) {
      connectionState.value = "offline";
      // 离线时清空旧状态，避免保留看起来仍然在线的信息。
      status.value = null;
      return;
    }

    const next = await fetchServiceStatus();
    if (isDisposed) return;

    status.value = next;
    connectionState.value = "online";
  } catch {
    if (!isDisposed) {
      connectionState.value = "offline";
      status.value = null;
    }
  } finally {
    inFlight = false;
    // 串行轮询：本轮结束后再安排下一次，避免请求重叠。
    if (!isDisposed) {
      timer = window.setTimeout(() => void poll(), 5000);
    }
  }
}

onMounted(() => {
  isDisposed = false;
  void poll();
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
  <section
    class="status-bar"
    :class="`status-bar--${connectionState}`"
    aria-label="服务状态"
  >
    <span
      class="status-dot"
      :class="`status-dot--${connectionState}`"
      aria-hidden="true"
    ></span>
    <span class="status-conn">{{ connectionLabel }}</span>

    <template v-if="connectionState === 'online' && status">
      <span class="status-item">
        {{ status.mock ? "模拟模式（Mock）" : "真实推理" }}
      </span>
      <span class="status-sep" aria-hidden="true">·</span>
      <span class="status-item">设备：{{ status.device ?? "—" }}</span>
      <span class="status-sep" aria-hidden="true">·</span>
      <span class="status-item">
        当前模型：{{ status.loaded_model ?? "未加载" }}
      </span>
      <span class="status-sep" aria-hidden="true">·</span>
      <span class="status-item">引擎状态：{{ engineStateLabel }}</span>
    </template>

    <p v-if="connectionState === 'offline'" role="alert" class="status-offline">
      服务离线：请确认 TransHub 已启动（127.0.0.1:8765），可运行 run.bat 或
      run-real.bat 启动后刷新。
    </p>
  </section>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 18px;
  margin-bottom: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  font-size: 13px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--muted);
}

.status-dot--online {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 25%, transparent);
}

.status-dot--connecting {
  background: var(--warning);
}

.status-dot--offline {
  background: var(--danger);
}

.status-conn {
  font-weight: 650;
}

.status-bar--online .status-conn {
  color: var(--success);
}

.status-bar--connecting .status-conn {
  color: var(--warning);
}

.status-bar--offline .status-conn {
  color: var(--danger);
}

.status-item {
  color: var(--text);
}

.status-sep {
  color: var(--border);
}

.status-offline {
  flex-basis: 100%;
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
</style>
