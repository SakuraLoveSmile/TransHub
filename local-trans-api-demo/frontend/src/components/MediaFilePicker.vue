<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ disabled: boolean }>();

const file = defineModel<File | null>({ required: true });
const input = ref<HTMLInputElement | null>(null);
const errorMessage = ref("");
const dragActive = ref(false);

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

function onDrop(event: DragEvent) {
  dragActive.value = false;
  if (props.disabled) return;
  selectFiles(event.dataTransfer?.files ?? null);
}

function removeFile() {
  file.value = null;
  errorMessage.value = "";
}

function formatSize(size: number): string {
  return (size / 1024 / 1024).toFixed(2);
}
</script>

<template>
  <div
    class="file-picker"
    :class="{ 'drag-active': dragActive }"
    @dragover.prevent="dragActive = true"
    @dragleave.prevent="dragActive = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      type="file"
      hidden
      :accept="extensions.join(',')"
      :disabled="disabled"
      :aria-describedby="errorMessage ? 'file-picker-error' : undefined"
      @change="onChange"
    />

    <template v-if="file">
      <strong class="file-name">{{ file.name }}</strong>
      <p>{{ formatSize(file.size) }} MiB</p>
      <button type="button" :disabled="disabled" @click="removeFile">
        移除文件
      </button>
    </template>

    <template v-else>
      <p>将音视频拖到这里</p>
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

    <p
      v-if="errorMessage"
      id="file-picker-error"
      role="alert"
      class="error-text"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>