<template>
  <main class="app">
    <header class="app-header">
      <div>
        <p class="app-kicker">TRANSHUB</p>
        <h1>TransHub</h1>
      </div>
      <p class="app-subtitle">本地字幕工作台</p>
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
import "./styles.css";

const hasActiveTasks = ref(false);
</script>
