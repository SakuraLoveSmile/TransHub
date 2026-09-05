<template>
  <div class="app">
    <header class="app-header">
      <h1>TransHub</h1>
      <p class="app-subtitle">本地字幕工作台</p>
    </header>
    <div class="workspace">
      <div class="zone zone-status">
        <ServiceStatus />
      </div>
      <SubtitleTasks @active-change="handleActiveChange" />
      <div class="zone zone-models">
        <ModelPanel :has-active-tasks="hasActiveTasks" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import ModelPanel from "./components/ModelPanel.vue";
import ServiceStatus from "./components/ServiceStatus.vue";
import SubtitleTasks from "./components/SubtitleTasks.vue";
import "./styles.css";

const hasActiveTasks = ref(false);

function handleActiveChange(value: boolean) {
  hasActiveTasks.value = value;
}
</script>
