<template>
  <div class="app">
    <header class="app-header">
      <h1>TransHub</h1>
      <p>本地字幕工作台</p>
    </header>

    <ServiceStatus />

    <SubtitleTasks @active-change="hasActiveTasks = $event">
      <template #aside>
        <ModelPanel :has-active-tasks="hasActiveTasks" />
      </template>
    </SubtitleTasks>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import ModelPanel from "./components/ModelPanel.vue";
import ServiceStatus from "./components/ServiceStatus.vue";
import SubtitleTasks from "./components/SubtitleTasks.vue";

const hasActiveTasks = ref(false);
</script>
