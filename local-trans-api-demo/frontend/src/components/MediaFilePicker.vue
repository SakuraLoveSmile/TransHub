<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ disabled: boolean }>();

const file = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");
const isDragging = ref(false);

const errorId = "media-file-picker-error";

const extensions = [
  ".wav",
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".mp4",
  ".mkv",
  ".webm",
];

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

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

function onDrop(event: DragEvent) {
  isDragging.value = false;
  if (props.disabled) return;
  selectFiles(event.dataTransfer?.files ?? null);
}

function removeFile() {
  file.value = null;
  errorMessage.value = "";
}
</script>

<template>
  <div
    class="file-picker"
    :class="{ 'file-picker--dragging': isDragging, 'file-picker--has-file': file }"
    :aria-describedby="errorMessage ? errorId : undefined"
    @dragover.prevent="!disabled && (isDragging = true)"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
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
      <p class="file-size">{{ formatSize(file.size) }}</p>
      <button
        type="button"
        class="button-ghost"
        :disabled="disabled"
        @click="removeFile"
      >
        移除文件
      </button>
    </template>

    <template v-else>
      <p class="file-picker__lead">将音视频拖到这里</p>
      <button
        type="button"
        class="button-primary"
        :disabled="disabled"
        @click="input?.click()"
      >
        选择文件
      </button>
      <p class="hint">支持 WAV、FLAC、MP3、MP4 等现有格式</p>
    </template>

    <p v-if="errorMessage" :id="errorId" role="alert" class="error">
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.file-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: var(--bg);
  text-align: center;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.file-picker--dragging {
  border-color: var(--accent);
  background: var(--surface-hover);
}

.file-picker--has-file {
  border-style: solid;
  text-align: left;
}

.file-picker__lead {
  margin: 0;
  color: var(--muted);
}

.file-name {
  font-size: 15px;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.file-size {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}

.button-ghost {
  align-self: flex-start;
  min-height: 36px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.button-ghost:hover:not(:disabled) {
  background: var(--surface-hover);
}
</style>
