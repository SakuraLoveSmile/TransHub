<script lang="ts">
let pickerSeq = 0;
</script>

<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ disabled: boolean }>();

const file = defineModel<File | null>({ required: true });

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

pickerSeq += 1;
const errorId = `file-picker-error-${pickerSeq}`;

const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");
const isDragging = ref(false);

function formatSize(size: number): string {
  return `${(size / 1024 / 1024).toFixed(2)} MiB`;
}

function selectFiles(files: FileList | File[] | null | undefined): void {
  errorMessage.value = "";

  if (!files || files.length === 0) return;

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

function onChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  selectFiles(target.files);
  target.value = "";
}

function onDragOver(): void {
  if (props.disabled) return;
  isDragging.value = true;
}

function onDrop(event: DragEvent): void {
  isDragging.value = false;
  if (props.disabled) return;
  selectFiles(event.dataTransfer?.files);
}

function removeFile(): void {
  file.value = null;
  errorMessage.value = "";
}
</script>

<template>
  <div
    class="file-picker"
    :class="{ 'is-dragging': isDragging }"
    :aria-describedby="errorMessage ? errorId : undefined"
    @dragenter.prevent="onDragOver"
    @dragover.prevent="onDragOver"
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
      <strong class="file-name break-anywhere">{{ file.name }}</strong>
      <p class="file-size">{{ formatSize(file.size) }}</p>
      <button
        type="button"
        class="button-secondary"
        :disabled="disabled"
        @click="removeFile"
      >
        移除文件
      </button>
    </template>

    <template v-else>
      <p class="drop-hint">将音视频拖到这里</p>
      <button
        type="button"
        class="button-secondary"
        :disabled="disabled"
        @click="input?.click()"
      >
        选择文件
      </button>
      <p class="text-hint">支持 WAV、FLAC、MP3、MP4 等现有格式</p>
    </template>

    <p v-if="errorMessage" :id="errorId" role="alert" class="message-alert">
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.file-picker {
  display: grid;
  gap: 10px;
  justify-items: start;
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.file-picker.is-dragging {
  border-color: var(--accent);
  background: rgba(165, 180, 252, 0.08);
}

.file-name {
  font-size: 14px;
}

.file-size,
.drop-hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
</style>
