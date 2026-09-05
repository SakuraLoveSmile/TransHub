<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{ disabled: boolean }>();

const file = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");
const isDragOver = ref(false);
let dragDepth = 0;

const extensions = [
  ".wav", ".flac", ".mp3", ".m4a", ".aac",
  ".ogg", ".opus", ".mp4", ".mkv", ".webm",
];

const describedBy = computed(() => {
  if (errorMessage.value) return "file-picker-error";
  if (!file.value) return "file-picker-hint";
  return undefined;
});

function selectFiles(files: FileList | File[] | null) {
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

function onDragEnter() {
  if (props.disabled) return;
  dragDepth += 1;
  isDragOver.value = true;
}

function onDragLeave() {
  if (props.disabled) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDragOver.value = false;
}

function onDrop(event: DragEvent) {
  dragDepth = 0;
  isDragOver.value = false;
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
    :class="{ 'is-dragover': isDragOver, 'has-file': file }"
    role="group"
    aria-label="音视频文件"
    :aria-describedby="describedBy"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
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
      <strong class="file-name">{{ file.name }}</strong>
      <p class="file-meta">{{ (file.size / 1024 / 1024).toFixed(2) }} MiB</p>
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
      <p id="file-picker-hint" class="hint">
        支持 WAV、FLAC、MP3、M4A、AAC、OGG、OPUS、MP4、MKV、WEBM
      </p>
    </template>

    <p v-if="errorMessage" id="file-picker-error" role="alert" class="error-text">
      {{ errorMessage }}
    </p>
  </div>
</template>
