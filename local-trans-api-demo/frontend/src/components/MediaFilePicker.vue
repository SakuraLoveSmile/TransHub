<template>
  <div
    class="file-picker"
    :class="{ 'is-dragging': isDragging && !disabled }"
    @dragover.prevent="onDragOver"
    @dragenter.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      id="media"
      type="file"
      class="visually-hidden-input"
      :accept="accept"
      :disabled="disabled"
      :aria-invalid="errorMessage ? 'true' : undefined"
      :aria-describedby="errorMessage ? 'media-error' : undefined"
      @change="onChange"
    />

    <template v-if="file">
      <strong class="file-name">{{ file.name }}</strong>
      <p class="file-size">{{ formatMiB(file.size) }} MiB</p>
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
      <p class="drop-hint">将音视频拖到这里，或</p>
      <button
        type="button"
        class="button-ghost"
        :disabled="disabled"
        @click="openDialog"
      >
        选择文件
      </button>
      <p class="hint">支持 WAV、FLAC、MP3、MP4 等现有格式</p>
    </template>

    <p v-if="errorMessage" id="media-error" role="alert" class="error">
      {{ errorMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const props = withDefaults(defineProps<{ disabled?: boolean }>(), {
  disabled: false,
});

const file = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");
const isDragging = ref(false);

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

const accept = extensions.join(",");

function formatMiB(size: number): string {
  return (size / 1024 / 1024).toFixed(2);
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

function onDragOver() {
  if (props.disabled) return;
  isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

function onDrop(event: DragEvent) {
  isDragging.value = false;
  if (props.disabled) return;
  selectFiles(event.dataTransfer?.files ?? null);
}

function openDialog() {
  input.value?.click();
}

function removeFile() {
  file.value = null;
  errorMessage.value = "";
}
</script>

<style scoped>
.file-picker {
  display: grid;
  gap: 8px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 16px;
  background: var(--surface-2);
  text-align: center;
}

.file-picker.is-dragging {
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--surface-hover);
}

.visually-hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.file-name {
  overflow-wrap: anywhere;
  word-break: break-all;
  min-width: 0;
}

.file-size,
.drop-hint {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}

.hint {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}

.error {
  margin: 0;
  text-align: left;
}
</style>
