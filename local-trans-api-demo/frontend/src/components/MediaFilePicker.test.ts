import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function makeFile(name: string, size = 1024, type = "audio/wav"): File {
  const content = size > 0 ? new Uint8Array(size) : new Uint8Array(0);
  return new File([content], name, { type });
}

function mountPicker(modelValue: File | null = null) {
  return mount(MediaFilePicker, {
    props: { disabled: false, modelValue },
  });
}

async function setFiles(wrapper: ReturnType<typeof mountPicker>, files: File[]) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: files,
    configurable: true,
  });
  await input.trigger("change");
}

describe("MediaFilePicker", () => {
  it("emits a single valid file through v-model", async () => {
    const wrapper = mountPicker();
    const file = makeFile("sample.wav");
    await setFiles(wrapper, [file]);

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted?.[emitted.length - 1][0]).toBe(file);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("rejects an empty file with an alert", async () => {
    const wrapper = mountPicker();
    await setFiles(wrapper, [makeFile("empty.wav", 0)]);

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("文件为空");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("rejects an unsupported extension", async () => {
    const wrapper = mountPicker();
    await setFiles(wrapper, [makeFile("notes.pdf", 2048, "application/pdf")]);

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("暂不支持这个文件格式");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("rejects multiple files dropped at once", async () => {
    const wrapper = mountPicker();
    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: { files: [makeFile("a.wav"), makeFile("b.wav")] },
    });

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("一次请选择一个音视频文件");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("accepts a single dropped file", async () => {
    const wrapper = mountPicker();
    const file = makeFile("drop.flac", 4096, "audio/flac");
    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: { files: [file] },
    });

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.[emitted.length - 1][0]).toBe(file);
  });

  it("shows file summary and clears on remove, then allows reselect", async () => {
    const file = makeFile("long-name-audio-sample.wav", 5 * 1024 * 1024);
    const wrapper = mountPicker(file);

    expect(wrapper.text()).toContain("long-name-audio-sample.wav");
    expect(wrapper.text()).toContain("5.00 MiB");

    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.[emitted.length - 1][0]).toBeNull();

    // 移除后可重新选择。
    const next = makeFile("second.wav");
    await setFiles(wrapper, [next]);
    const emittedAgain = wrapper.emitted("update:modelValue");
    expect(emittedAgain?.[emittedAgain.length - 1][0]).toBe(next);
  });

  it("disables interactions when disabled", () => {
    const wrapper = mount(MediaFilePicker, {
      props: { disabled: true, modelValue: null },
    });
    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();
  });
});
