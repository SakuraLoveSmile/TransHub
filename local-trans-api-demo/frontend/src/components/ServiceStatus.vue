<template>
  <section class="panel" aria-label="服务状态">
    <h2>服务状态</h2>
    <p v-if="phase === 'connecting'" role="status" class="hint">
      正在连接…
    </p>
    <template v-else-if="phase === 'offline'">
      <p role="alert" class="offline">
        服务离线：请确认 TransHub 已启动（127.0.0.1:8765）。
      </p>
      <p class="hint">
        若真实服务无法启动，请查看 run-real.bat
        控制台输出（浏览器无法读取该诊断）。
      </p>
    </template>
    <dl v-else class="status-grid">
      <div>
        <dt>连接</dt>
        <dd>已连接</dd>
      </div>
      <div>
        <dt>运行模式</dt>
        <dd>
          <span v-if="status?.mock" class="mock-badge">模拟模式（Mock）</span>
          <span v-else>真实推理</span>
        </dd>
      </div>
      <div>
        <dt>引擎</dt>
        <dd>{{ engineLabel }}</dd>
      </div>
      <div>
        <dt>设备</dt>
        <dd>{{ status?.device ?? "未知" }}</dd>
      </div>
      <div>
        <dt>当前模型</dt>
        <dd>{{ status?.loaded_model ?? "未加载" }}</dd>
      </div>
      <div>
        <dt>引擎状态</dt>
        <dd>{{ status?.status === "running" ? "处理中" : "空闲" }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

type Phase = "connecting" | "online" | "offline";

const phase = ref<Phase>("connecting");
const status = ref<ServiceStatus | null>(null);
let refreshing = false;
let disposed = false;

const engineLabel = computed(() => {
  const engine = status.value?.engine;
  if (!engine || engine === "unknown") return "未知";
  return engine;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refresh() {
  const ok = await checkHealth();
  if (disposed) return;
  if (!ok) {
    // 离线不保留旧在线态，避免展示过期信息。
    phase.value = "offline";
    status.value = null;
    return;
  }
  try {
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

async function pollLoop() {
  while (!disposed) {
    if (!refreshing) {
      refreshing = true;
      try {
        await refresh();
      } finally {
        refreshing = false;
      }
    }
    // 上一次请求结束后再等待，请求永不重叠。
    await sleep(5000);
  }
}

onMounted(() => {
  disposed = false;
  void pollLoop();
});

onUnmounted(() => {
  disposed = true;
});
</script>

<style scoped>
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius, 10px);
  padding: 16px;
  margin-bottom: 0;
}
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin: 0;
}
.status-grid dt {
  font-size: 12px;
  color: var(--muted);
}
.status-grid dd {
  margin: 0;
  font-weight: 600;
  color: var(--text);
}
.mock-badge {
  color: var(--warning);
  background: var(--warning-bg);
  border: 1px solid rgba(232, 178, 62, 0.55);
  border-radius: 4px;
  padding: 2px 8px;
  white-space: nowrap;
}
.offline {
  color: var(--danger);
  font-weight: 600;
  background: var(--danger-bg);
  border: 1px solid rgba(255, 122, 122, 0.4);
  border-radius: 8px;
  padding: 8px 10px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
}
</style>
