import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function makeFile(name: string, size: number, type = "audio/wav"): File {
  const bytes = new Uint8Array(Math.max(0, size));
  return new File([bytes], name, { type });
}

function setInputFiles(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.find("#media");
  expect(input.exists()).toBe(true);
  const el = input.element as HTMLInputElement;
  Object.defineProperty(el, "files", { value: [file], configurable: true });
  return input.trigger("change");
}

function lastPayload(
  wrapper: ReturnType<typeof mount>,
  event: string,
): unknown {
  const emitted = wrapper.emitted(event);
  if (!emitted || emitted.length === 0) return undefined;
  return emitted[emitted.length - 1][0];
}

describe("MediaFilePicker", () => {
  it("renders label, dialog button, native input and drop hint", () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null },
    });
    expect(wrapper.find("label[for='media']").text()).toContain("音视频文件");
    expect(wrapper.find(".pick-button").text()).toContain("选择文件");
    expect(wrapper.find("#media").exists()).toBe(true);
    expect(wrapper.text()).toContain("一次一个");
    wrapper.unmount();
  });

  it("accepts a valid file and shows name + MiB summary", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, "onUpdate:modelValue": () => {} },
    });
    const file = makeFile("speech.wav", 1024 * 1024, "audio/wav");
    await setInputFiles(wrapper, file);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(lastPayload(wrapper, "update:modelValue")).toBe(file);
    // Parent syncs v-model back; summary renders name + MiB.
    await wrapper.setProps({ modelValue: file });
    expect(wrapper.find(".file-name").text()).toBe("speech.wav");
    expect(wrapper.find(".file-size").text()).toBe("1.00 MiB");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("rejects empty files with role=alert", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, "onUpdate:modelValue": () => {} },
    });
    await setInputFiles(wrapper, makeFile("empty.wav", 0));
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("文件为空");
    expect(lastPayload(wrapper, "update:modelValue")).toBeNull();
    wrapper.unmount();
  });

  it("rejects unsupported extensions with role=alert", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, "onUpdate:modelValue": () => {} },
    });
    await setInputFiles(wrapper, makeFile("notes.txt", 100, "text/plain"));
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("不支持的文件类型");
    expect(lastPayload(wrapper, "update:modelValue")).toBeNull();
    wrapper.unmount();
  });

  it("uses only the first file on multi-file drop with a notice", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, "onUpdate:modelValue": () => {} },
    });
    const first = makeFile("a.wav", 10);
    const second = makeFile("b.wav", 10);
    const zone = wrapper.find(".dropzone");
    await zone.trigger("drop", {
      dataTransfer: { files: [first, second] },
    });
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(lastPayload(wrapper, "update:modelValue")).toBe(first);
    await wrapper.setProps({ modelValue: first });
    expect(wrapper.find(".file-name").text()).toBe("a.wav");
    // Multi-drop notice is surfaced as the picker error line.
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "一次只能选择一个文件",
    );
    wrapper.unmount();
  });

  it("drop of a single file emits without a notice", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, "onUpdate:modelValue": () => {} },
    });
    const file = makeFile("solo.mp3", 100, "audio/mpeg");
    await wrapper
      .find(".dropzone")
      .trigger("drop", { dataTransfer: { files: [file] } });
    expect(lastPayload(wrapper, "update:modelValue")).toBe(file);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("remove clears v-model and empties the native input for reselect", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: makeFile("speech.wav", 100) },
    });
    const input = wrapper.find("#media").element as HTMLInputElement;
    // Simulate a previously selected file present in the native input.
    Object.defineProperty(input, "value", {
      value: "C:\\fakepath\\speech.wav",
      writable: true,
      configurable: true,
    });
    await wrapper.find(".remove-button").trigger("click");
    expect(lastPayload(wrapper, "update:modelValue")).toBeNull();
    expect(input.value).toBe("");
    // Parent null sync also clears the native input (same-file reselect).
    await wrapper.setProps({ modelValue: null });
    expect(input.value).toBe("");
    wrapper.unmount();
  });

  it("highlights the dropzone while dragging", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null },
    });
    await wrapper.find(".dropzone").trigger("dragover");
    expect(wrapper.find(".dropzone").classes()).toContain("is-dragging");
    await wrapper.find(".dropzone").trigger("dragleave");
    expect(wrapper.find(".dropzone").classes()).not.toContain("is-dragging");
    wrapper.unmount();
  });
});
