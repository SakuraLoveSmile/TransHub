<template>
  <section class="status-strip" aria-label="服务状态">
    <template v-if="phase === 'connecting'">
      <span class="dot dot-connecting" aria-hidden="true"></span>
      <span class="status-label">正在连接</span>
      <span class="muted-text">请求完成前不显示连接状态</span>
    </template>

    <template v-else-if="phase === 'online'">
      <span class="dot dot-online" aria-hidden="true"></span>
      <span class="status-label">已连接</span>
      <span class="muted-text">
        {{ status?.mock ? "模拟模式" : "真实推理" }}
      </span>
      <span v-if="status?.device" class="chip chip-info">{{ status.device }}</span>
      <span v-else class="chip chip-neutral">设备未知</span>
      <span class="muted-text">当前模型：{{ status?.loaded_model ?? "未加载" }}</span>
      <span class="muted-text">引擎：{{ engineLabel }}</span>
      <span class="muted-text">引擎状态：{{ engineStateLabel }}</span>
    </template>

    <template v-else>
      <span class="dot dot-offline" aria-hidden="true"></span>
      <span role="alert" class="status-label status-offline">服务离线</span>
      <span class="muted-text">
        请启动 TransHub（127.0.0.1:8765）；若真实服务无法启动，请查看
        run-real.bat 控制台输出。
      </span>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

type Phase = "connecting" | "online" | "offline";

const phase = ref<Phase>("connecting");
const status = ref<ServiceStatus | null>(null);
let disposed = false;
let timer: number | undefined;

const engineLabel = computed(() => {
  const engine = status.value?.engine;
  if (!engine || engine === "unknown") return "未知";
  return engine;
});

const engineStateLabel = computed(() => {
  if (!status.value) return "—";
  // 未知引擎状态显示“未知”，不能统一当作空闲。
  if (status.value.status === "running") return "处理中";
  if (status.value.status === "idle") return "空闲";
  return "未知";
});

async function refresh() {
  try {
    const ok = await checkHealth();
    if (disposed) return;
    if (!ok) {
      // 离线时不保留旧在线状态，避免展示过期信息。
      phase.value = "offline";
      status.value = null;
      return;
    }
    const latest = await fetchServiceStatus();
    if (disposed) return;
    status.value = latest;
    phase.value = "online";
  } catch {
    if (disposed) return;
    phase.value = "offline";
    status.value = null;
  }
}

function schedule() {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(
    () =>
      void (async () => {
        await refresh();
        if (!disposed) schedule();
      })(),
    5000,
  );
}

onMounted(() => {
  disposed = false;
  void refresh();
  schedule();
});

onUnmounted(() => {
  disposed = true;
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>

<style scoped>
.status-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  grid-area: status;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-connecting {
  background: var(--warning);
}

.dot-online {
  background: var(--success);
}

.dot-offline {
  background: var(--danger);
}

.status-label {
  font-weight: 650;
}

.status-offline {
  color: var(--danger);
}
</style>
