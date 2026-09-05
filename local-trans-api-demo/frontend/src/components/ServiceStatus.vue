<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { checkHealth, fetchServiceStatus, type ServiceStatus } from "../api";

const phase = ref<"connecting" | "online" | "offline">("connecting");
const status = ref<ServiceStatus | null>(null);
let isRefreshing = false;
let timer: number | undefined;
let disposed = false;

const engineState = ref("未知");

async function refresh() {
  if (isRefreshing || disposed) return;
  isRefreshing = true;
  try {
    const ok = await checkHealth();
    if (disposed) return;
    if (!ok) {
      phase.value = "offline";
      return;
    }
    const next = await fetchServiceStatus();
    if (disposed) return;
    status.value = next;
    phase.value = "online";
    // 未知引擎状态显示「未知」，不能统一当作空闲。
    engineState.value = next.status === "running" ? "处理中" : next.status ? "空闲" : "未知";
  } catch {
    if (!disposed) phase.value = "offline";
  } finally {
    isRefreshing = false;
  }
}

onMounted(() => {
  disposed = false;
  void refresh();
  timer = window.setInterval(() => void refresh(), 5000);
});

onUnmounted(() => {
  disposed = true;
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <section class="status-bar" aria-label="服务状态">
    <span
      v-if="phase === 'connecting'"
      class="status-dot connecting"
      role="status"
    >正在连接服务…</span>

    <template v-else-if="phase === 'online'">
      <span class="status-dot online">已连接</span>
      <span class="status-item">模式<strong>{{
        status?.mock ? "模拟（Mock）" : "真实推理"
      }}</strong></span>
      <span v-if="status?.device" class="status-item">设备<strong>{{ status.device }}</strong></span>
      <span class="status-item">当前模型<strong>{{ status?.loaded_model ?? "未加载" }}</strong></span>
      <span class="status-item">引擎状态<strong>{{ engineState }}</strong></span>
    </template>

    <template v-else>
      <span class="status-dot offline" role="alert">服务离线</span>
      <p class="offline-note">
        请先在本机启动 TransHub 服务（默认 127.0.0.1:8765）。
        <span class="hint">若真实服务无法启动，请查看 run-real.bat 控制台输出。</span>
      </p>
    </template>
  </section>
</template>
