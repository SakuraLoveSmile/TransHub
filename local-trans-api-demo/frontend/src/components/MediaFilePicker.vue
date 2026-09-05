<template>
  <div class="picker" :class="{ 'is-dragging': isDragging && !disabled }">
    <label :for="inputId" class="picker-label">{{ label }}</label>
    <div
      class="dropzone"
      :class="{ 'is-dragging': isDragging && !disabled }"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <input
        ref="inputRef"
        :id="inputId"
        type="file"
        class="picker-input"
        :accept="accept"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        @change="onInputChange"
      />
      <div class="picker-actions">
        <button
          type="button"
          class="pick-button"
          :disabled="disabled"
          @click="openDialog"
        >
          选择文件
        </button>
        <span class="drop-hint">或将文件拖到此处（一次一个）</span>
      </div>
    </div>
    <p v-if="error" :id="errorId" role="alert" class="error">{{ error }}</p>
    <div v-if="modelValue" class="summary">
      <span class="file-name" :title="modelValue.name">{{
        modelValue.name
      }}</span>
      <span class="file-size">{{ formatMiB(modelValue.size) }}</span>
      <button
        type="button"
        class="remove-button"
        :disabled="disabled"
        @click="remove"
      >
        移除
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: File | null;
    disabled?: boolean;
    inputId?: string;
    label?: string;
    accept?: string;
  }>(),
  {
    disabled: false,
    inputId: "media",
    label: "音视频文件",
    accept: ".wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.mkv,.webm",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: File | null): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const error = ref("");

const errorId = computed(() => `${props.inputId}-error`);

const allowedExtensions = computed(() =>
  props.accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.startsWith("."))
    .map((part) => part.slice(1)),
);

function formatMiB(size: number): string {
  return `${(size / 1024 / 1024).toFixed(2)} MiB`;
}

function validateFile(file: File): string {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!extension || !allowedExtensions.value.includes(extension)) {
    return `不支持的文件类型，请选择 ${props.accept} 范围内的音视频文件。`;
  }
  if (file.size === 0) {
    return "文件为空，请选择有效的音视频文件。";
  }
  return "";
}

function acceptFile(file: File, multiNotice: string): void {
  const message = validateFile(file);
  if (message) {
    error.value = message;
    emit("update:modelValue", null);
    syncInputEmpty();
    return;
  }
  error.value = multiNotice;
  emit("update:modelValue", file);
}

function syncInputEmpty(): void {
  if (inputRef.value) inputRef.value.value = "";
}

function openDialog(): void {
  inputRef.value?.click();
}

function onInputChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0] ?? null;
  if (!file) return;
  acceptFile(file, "");
}

function onDragOver(): void {
  if (props.disabled) return;
  isDragging.value = true;
}

function onDragLeave(): void {
  isDragging.value = false;
}

function onDrop(event: DragEvent): void {
  isDragging.value = false;
  if (props.disabled) return;
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const first = files[0];
  if (!first) return;
  const notice =
    files.length > 1 ? "一次只能选择一个文件，已使用第一个文件。" : "";
  acceptFile(first, notice);
}

function remove(): void {
  error.value = "";
  emit("update:modelValue", null);
  syncInputEmpty();
}

// 父组件把 v-model 置空（如提交成功后清空）时，同步清空原生 input，
// 保证同一文件可以再次被选中。
watch(
  () => props.modelValue,
  (value) => {
    if (value === null) syncInputEmpty();
  },
);
</script>

<style scoped>
.picker {
  display: grid;
  gap: 8px;
}
.picker-label {
  font-weight: 600;
}
.dropzone {
  border: 1px dashed var(--border, #ccc);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface, #fff);
}
.dropzone.is-dragging {
  border-color: var(--accent, #4c8dff);
  border-style: solid;
  background: var(--drop-active, #eef4ff);
}
.picker-input {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}
.picker-input:focus-visible,
.pick-button:focus-visible,
.remove-button:focus-visible {
  outline: 2px solid var(--accent, #4c8dff);
  outline-offset: 2px;
}
.picker-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pick-button,
.remove-button {
  cursor: pointer;
  border: 1px solid var(--border, #ccc);
  border-radius: 6px;
  padding: 6px 14px;
  background: var(--button-bg, #f4f4f5);
  color: var(--text, #222);
}
.pick-button:disabled,
.remove-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.drop-hint {
  font-size: 13px;
  color: var(--muted, #666);
}
.error {
  color: var(--error, #a00);
  margin: 0;
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  padding: 8px 10px;
}
.file-name {
  font-weight: 600;
  overflow-wrap: anywhere;
  word-break: break-all;
  min-width: 0;
  flex: 1 1 160px;
}
.file-size {
  font-size: 12px;
  color: var(--muted, #666);
  white-space: nowrap;
}
</style>
