import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function makeFile(name: string, size = 2048): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

function mountPicker(disabled = false) {
  return mount(MediaFilePicker, {
    props: { modelValue: null, disabled },
  });
}

async function selectThroughInput(wrapper: ReturnType<typeof mountPicker>, files: File[]) {
  const input = wrapper.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    value: files,
    configurable: true,
  });
  await input.trigger("change");
}

function dropFiles(wrapper: ReturnType<typeof mountPicker>, files: File[]) {
  const target = wrapper.get(".file-picker").element;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  target.dispatchEvent(event);
  return wrapper.vm.$nextTick();
}

function lastEmittedFile(wrapper: ReturnType<typeof mountPicker>): unknown {
  const emitted = wrapper.emitted("update:modelValue");
  return emitted?.[emitted.length - 1]?.[0];
}

describe("MediaFilePicker", () => {
  it("接受单个受支持文件并展示名称与大小", async () => {
    const wrapper = mountPicker();
    await selectThroughInput(wrapper, [makeFile("episode01.wav", 4 * 1024 * 1024)]);

    expect(lastEmittedFile(wrapper)).toBeInstanceOf(File);
    expect(wrapper.text()).toContain("episode01.wav");
    expect(wrapper.text()).toContain("4.00 MiB");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("拒绝空文件", async () => {
    const wrapper = mountPicker();
    await selectThroughInput(wrapper, [makeFile("empty.mp3", 0)]);

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toBe("文件为空，请重新选择。");
  });

  it("拒绝不支持的扩展名", async () => {
    const wrapper = mountPicker();
    await selectThroughInput(wrapper, [makeFile("notes.txt")]);

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "暂不支持这个文件格式，请选择音频或视频文件。",
    );
  });

  it("拒绝一次拖入多个文件", async () => {
    const wrapper = mountPicker();
    await dropFiles(wrapper, [makeFile("a.wav"), makeFile("b.wav")]);

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toBe(
      "一次请选择一个音视频文件。",
    );
  });

  it("拖入单个文件时高亮并选中，移除后可重新选择", async () => {
    const wrapper = mountPicker();

    wrapper.get(".file-picker").element.dispatchEvent(
      new Event("dragenter", { bubbles: true, cancelable: true }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".file-picker").classes()).toContain("is-dragging");

    await dropFiles(wrapper, [makeFile("drop.mkv")]);
    expect(wrapper.get(".file-picker").classes()).not.toContain("is-dragging");
    expect(wrapper.text()).toContain("drop.mkv");

    await wrapper.get("button").trigger("click");
    expect(lastEmittedFile(wrapper)).toBeNull();
    expect(wrapper.text()).toContain("将音视频拖到这里");

    await selectThroughInput(wrapper, [makeFile("again.mp3")]);
    expect(wrapper.text()).toContain("again.mp3");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("禁用时忽略拖入", async () => {
    const wrapper = mountPicker(true);
    await dropFiles(wrapper, [makeFile("locked.wav")]);

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
  });
});
