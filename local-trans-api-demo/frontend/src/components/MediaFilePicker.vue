<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ disabled: boolean }>();

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

function onDragEnter() {
  if (!props.disabled) isDragging.value = true;
}

function onDragLeave(event: DragEvent) {
  const picker = event.currentTarget;
  if (picker instanceof Node && event.relatedTarget instanceof Node) {
    if (picker.contains(event.relatedTarget)) return;
  }
  isDragging.value = false;
}

function onDrop(event: DragEvent) {
  isDragging.value = false;
  if (props.disabled) return;
  selectFiles(event.dataTransfer?.files ?? null);
}
</script>

<template>
  <div
    class="file-picker"
    :class="{ 'is-dragging': isDragging }"
    :aria-describedby="errorMessage ? 'file-picker-error' : 'file-picker-hint'"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragEnter"
    @dragleave.prevent="onDragLeave"
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
      <strong class="file-name text-wrap">{{ file.name }}</strong>
      <p class="hint">{{ (file.size / 1024 / 1024).toFixed(2) }} MiB</p>
      <button type="button" class="button button-small" :disabled="disabled" @click="removeFile">
        移除文件
      </button>
    </template>

    <template v-else>
      <p class="drop-title">将音视频拖到这里</p>
      <button type="button" class="button" :disabled="disabled" @click="input?.click()">
        选择文件
      </button>
      <p id="file-picker-hint" class="hint">支持 WAV、FLAC、MP3、MP4 等现有格式</p>
    </template>

    <p v-if="errorMessage" id="file-picker-error" role="alert" class="error-text">
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.file-picker {
  display: grid;
  gap: 8px;
  justify-items: start;
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: var(--bg);
}

.file-picker.is-dragging {
  border-color: var(--accent);
  background: var(--surface-hover);
}

.drop-title {
  margin: 0;
  font-weight: 600;
}

.file-name {
  max-width: 100%;
  line-height: 1.4;
}
</style>
