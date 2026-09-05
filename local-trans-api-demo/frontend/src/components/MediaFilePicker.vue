<script setup lang="ts">
import { ref } from "vue";

defineProps<{ disabled: boolean }>();

const file = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");

const extensions = [
  ".wav", ".flac", ".mp3", ".m4a", ".aac",
  ".ogg", ".opus", ".mp4", ".mkv", ".webm",
];

function selectFiles(files: FileList | null) {
  errorMessage.value = "";

  if (!files?.length) return;

  if (files.length !== 1) {
    errorMessage.value = "一次请选择一个音视频文件。";
    return;
  }

  const nextFile = files[0];
  const filename = nextFile.name.toLowerCase();

  if (!extensions.some((extension) => filename.endsWith(extension))) {
    errorMessage.value = "暂不支持这个文件格式，请选择音频或视频文件。";
    return;
  }

  if (nextFile.size === 0) {
    errorMessage.value = "文件为空，请重新选择。";
    return;
  }

  file.value = nextFile;
}

function onChange(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  selectFiles(target.files);
  target.value = "";
}

function removeFile() {
  file.value = null;
  errorMessage.value = "";
}

const isDragOver = ref(false);

function onDragOver() {
  isDragOver.value = true;
}
function onDragLeave() {
  isDragOver.value = false;
}
function onDrop(event: DragEvent) {
  isDragOver.value = false;
  if (!event.dataTransfer?.files) return;
  selectFiles(event.dataTransfer.files);
}
</script>

<template>
  <div
    class="file-picker"
    :class="{ 'is-dragover': isDragOver }"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="!disabled && onDrop($event)"
  >
    <input
      ref="input"
      type="file"
      hidden
      :accept="extensions.join(',')"
      :disabled="disabled"
      @change="onChange"
    />

    <template v-if="file">
      <strong class="file-name">{{ file.name }}</strong>
      <p class="file-size">{{ (file.size / 1024 / 1024).toFixed(2) }} MiB</p>
      <button class="remove-btn" type="button" :disabled="disabled" @click="removeFile">
        移除文件
      </button>
    </template>

    <template v-else>
      <p class="drop-text">将音视频拖到这里</p>
      <button
        class="select-btn"
        type="button"
        :disabled="disabled"
        @click="input?.click()"
      >
        选择文件
      </button>
      <p class="hint">支持 WAV、FLAC、MP3、MP4 等现有格式</p>
    </template>

    <p v-if="errorMessage" role="alert" class="error-msg">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.file-picker {
  border: 2px dashed var(--border);
  border-radius: 12px;
  padding: 32px 16px;
  text-align: center;
  transition: all 0.2s;
  background: var(--surface-hover);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.file-picker.is-dragover {
  border-color: var(--accent);
  background: rgba(165, 180, 252, 0.1);
}

.file-name {
  font-size: 14px;
  word-break: break-all;
}

.file-size {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.remove-btn {
  margin-top: 8px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.remove-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}

.drop-text {
  margin: 0;
  font-weight: 500;
}

.select-btn {
  padding: 8px 16px;
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.select-btn:hover:not(:disabled) {
  background: rgba(165, 180, 252, 0.1);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.error-msg {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}
</style>
