<template>
  <main class="app">
    <header class="app-header">
      <h1 class="app-title">TransHub</h1>
      <p class="app-tagline">本地字幕工作台</p>
    </header>

    <ServiceStatus />

    <div class="workspace">
      <SubtitleTasks @active-change="hasActiveTasks = $event" />
      <ModelPanel :has-active-tasks="hasActiveTasks" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import ModelPanel from "./components/ModelPanel.vue";
import ServiceStatus from "./components/ServiceStatus.vue";
import SubtitleTasks from "./components/SubtitleTasks.vue";

const hasActiveTasks = ref(false);
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.app-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.app-tagline {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
</style>
