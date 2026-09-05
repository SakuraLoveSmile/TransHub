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
const inputId = "media-file-input";
const errorId = "media-file-error";

function selectFiles(files: FileList | null) {
  errorMessage.value = "";

  if (!files?.length) return;

  if (files.length !== 1) {
    errorMessage.value = "一次请选择一个音视频文件。";
    return;
  }

  const nextFile = files[0];
  if (!nextFile) return;

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
  // Allow choosing the same file again after removing it or correcting an error.
  target.value = "";
}

function onDragOver() {
  if (!props.disabled) isDragging.value = true;
}

function onDragLeave(event: DragEvent) {
  const currentTarget = event.currentTarget;
  const relatedTarget = event.relatedTarget;
  if (
    currentTarget instanceof HTMLElement &&
    relatedTarget instanceof Node &&
    currentTarget.contains(relatedTarget)
  ) {
    return;
  }
  isDragging.value = false;
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
    :class="{ 'is-dragging': isDragging }"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <label class="field-label" :for="inputId">音视频文件</label>
    <input
      :id="inputId"
      ref="input"
      type="file"
      hidden
      :accept="extensions.join(',')"
      :disabled="disabled"
      :aria-describedby="errorMessage ? errorId : undefined"
      :aria-invalid="errorMessage ? 'true' : 'false'"
      @change="onChange"
    />

    <template v-if="file">
      <strong class="file-name">{{ file.name }}</strong>
      <p class="file-size">{{ (file.size / 1024 / 1024).toFixed(2) }} MiB</p>
      <button
        class="file-remove"
        type="button"
        :disabled="disabled"
        @click="removeFile"
      >
        移除文件
      </button>
    </template>

    <template v-else>
      <p>将音视频拖到这里</p>
      <button
        class="button-secondary"
        type="button"
        :disabled="disabled"
        @click="input?.click()"
      >
        选择文件
      </button>
      <p class="hint">支持 WAV、FLAC、MP3、MP4 等现有格式</p>
    </template>

    <p v-if="errorMessage" :id="errorId" class="file-error" role="alert">
      {{ errorMessage }}
    </p>
  </div>
</template>
