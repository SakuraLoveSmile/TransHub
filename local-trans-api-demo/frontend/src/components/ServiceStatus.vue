<template>
  <section class="status-bar" aria-label="服务状态" aria-live="polite">
    <span class="dot" :class="`dot-${phase}`" aria-hidden="true"></span>
    <strong>{{ phaseText }}</strong>

    <template v-if="phase === 'online' && status">
      <span class="badge" :class="status.mock ? 'badge-warning' : 'badge-info'">
        {{ status.mock ? "模拟模式（Mock）" : "真实推理" }}
      </span>
      <span class="badge">设备：{{ deviceText }}</span>
      <span class="badge">引擎：{{ engineText }}</span>
      <span class="badge">引擎状态：{{ engineStatusText }}</span>
      <span class="badge text-wrap">当前模型：{{ modelText }}</span>
    </template>

    <p v-if="phase === 'connecting'" class="hint">正在读取本地服务状态…</p>
    <p v-else-if="phase === 'offline'" class="hint">
      未连接到本地服务：请启动 TransHub（默认 http://127.0.0.1:8765）后重试；
      真实服务启动失败时请查看 run-real.bat 控制台输出。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

type Phase = "connecting" | "online" | "offline";

const PHASE_TEXT: Record<Phase, string> = {
  connecting: "正在连接",
  online: "已连接",
  offline: "离线",
};

const phase = ref<Phase>("connecting");
const status = ref<ServiceStatus | null>(null);

let timer: number | undefined;
let isPolling = false;
let isDisposed = false;

const phaseText = computed(() => PHASE_TEXT[phase.value]);

const deviceText = computed(() => status.value?.device || "未知");
const engineText = computed(() => {
  const engine = status.value?.engine;
  return engine && engine !== "unknown" ? engine : "未知";
});
const modelText = computed(() => status.value?.loaded_model || "未加载");
const engineStatusText = computed(() => {
  const value = status.value?.status;
  if (value === "running") return "处理中";
  if (value === "idle") return "空闲";
  return "未知";
});

async function refresh() {
  if (isPolling || isDisposed) return;
  isPolling = true;
  if (timer !== undefined) {
    window.clearTimeout(timer);
  }
  try {
    const ok = await checkHealth();
    if (isDisposed) return;
    if (!ok) {
      // 离线时清掉旧状态，避免看起来仍然在线。
      phase.value = "offline";
      status.value = null;
      return;
    }
    const next = await fetchServiceStatus();
    if (isDisposed) return;
    status.value = next;
    phase.value = "online";
  } catch {
    if (!isDisposed) {
      phase.value = "offline";
      status.value = null;
    }
  } finally {
    isPolling = false;
    if (!isDisposed) {
      timer = window.setTimeout(() => void refresh(), 5000);
    }
  }
}

onMounted(() => {
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

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid var(--muted);
  background: var(--muted);
}

.dot-online {
  border-color: var(--success);
  background: var(--success);
}

.dot-offline {
  border-color: var(--danger);
  background: var(--danger);
}

.status-bar .hint {
  flex: 1 1 260px;
}
</style>
