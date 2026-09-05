<!-- Implemented by Gemini 3.1 Pro -->
<template>
  <main class="app">
    <header class="app-header">
      <h1>TransHub</h1>
      <span class="subtitle">本地字幕工作台</span>
    </header>
    <div class="service-status-wrapper">
      <ServiceStatus class="panel" />
    </div>
    <div class="workspace">
      <SubtitleTasks @active-change="hasActiveTasks = $event" />
      <ModelPanel :has-active-tasks="hasActiveTasks" class="panel model-panel" />
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import "./styles.css";
import ModelPanel from "./components/ModelPanel.vue";
import ServiceStatus from "./components/ServiceStatus.vue";
import SubtitleTasks from "./components/SubtitleTasks.vue";

const hasActiveTasks = ref(false);
</script>

