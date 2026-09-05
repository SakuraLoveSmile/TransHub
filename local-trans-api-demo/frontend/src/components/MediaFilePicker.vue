<template>
  <div
    class="file-picker"
    :class="{ 'drag-over': dragActive }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      type="file"
      hidden
      :accept="acceptTypes"
      :disabled="disabled"
      :aria-describedby="errorMessage ? 'file-picker-error' : undefined"
      @change="onChange"
    />

    <template v-if="file">
      <p class="file-summary">
        <strong class="file-name">{{ file.name }}</strong>
        <span class="hint">{{ sizeLabel }}</span>
      </p>
      <button type="button" class="button-small" :disabled="disabled" @click="removeFile">
        移除文件
      </button>
    </template>

    <template v-else>
      <p class="file-empty">将音视频拖到这里，或</p>
      <button type="button" class="button-small" :disabled="disabled" @click="input?.click()">
        选择文件
      </button>
      <p class="hint">支持 WAV、FLAC、MP3、M4A、OGG、MP4、MKV、WEBM 等格式</p>
    </template>

    <p v-if="errorMessage" id="file-picker-error" role="alert" class="alert-error">
      {{ errorMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{ disabled: boolean }>();

const file = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");
const dragActive = ref(false);
let dragDepth = 0;

const extensions = [
  ".wav", ".flac", ".mp3", ".m4a", ".aac",
  ".ogg", ".opus", ".mp4", ".mkv", ".webm",
];

const acceptTypes = extensions.join(",");

const sizeLabel = computed(() => {
  if (!file.value) return "";
  return `${(file.value.size / 1024 / 1024).toFixed(2)} MiB`;
});

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
  if (props.disabled) return;
  dragDepth += 1;
  dragActive.value = true;
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragActive.value = false;
}

function onDrop(event: DragEvent) {
  dragDepth = 0;
  dragActive.value = false;
  if (props.disabled) return;
  selectFiles(event.dataTransfer?.files ?? null);
}
</script>
