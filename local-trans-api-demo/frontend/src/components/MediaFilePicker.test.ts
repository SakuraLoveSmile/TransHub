import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

type PickerWrapper = VueWrapper<InstanceType<typeof MediaFilePicker>>;

function makeFile(name: string, size = 1024): File {
  const content = size > 0 ? "x".repeat(size) : "";
  return new File([content], name, { type: "application/octet-stream" });
}

function asFileList(files: File[]): FileList {
  return files as unknown as FileList;
}

function lastEmittedValue(wrapper: PickerWrapper): unknown {
  const emitted = wrapper.emitted("update:modelValue");
  if (!emitted || emitted.length === 0) return undefined;
  return emitted[emitted.length - 1][0];
}

async function chooseFiles(wrapper: PickerWrapper, files: File[]) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: asFileList(files),
    configurable: true,
  });
  await input.trigger("change");
}

function mountPicker(modelValue: File | null = null, disabled = false) {
  return mount(MediaFilePicker, {
    props: { disabled, modelValue },
  });
}

describe("MediaFilePicker", () => {
  it("accepts a valid file and emits it via v-model", async () => {
    const wrapper = mountPicker();
    await chooseFiles(wrapper, [makeFile("demo.wav")]);

    const value = lastEmittedValue(wrapper) as File;
    expect(value.name).toBe("demo.wav");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("rejects an empty file with an alert", async () => {
    const wrapper = mountPicker();
    await chooseFiles(wrapper, [makeFile("empty.mp3", 0)]);

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("文件为空");
  });

  it("rejects unsupported extensions with an alert", async () => {
    const wrapper = mountPicker();
    await chooseFiles(wrapper, [makeFile("notes.txt")]);

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "暂不支持这个文件格式",
    );
  });

  it("rejects multi-file drops with an alert", async () => {
    const wrapper = mountPicker();
    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: {
        files: asFileList([makeFile("a.mp3"), makeFile("b.mp3")]),
      },
    });

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.find('[role="alert"]').text()).toContain(
      "一次请选择一个音视频文件。",
    );
  });

  it("accepts a single dropped file", async () => {
    const wrapper = mountPicker();
    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: { files: asFileList([makeFile("movie.mkv")]) },
    });

    expect((lastEmittedValue(wrapper) as File).name).toBe("movie.mkv");
  });

  it("ignores drops while disabled", async () => {
    const wrapper = mountPicker(null, true);
    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: { files: asFileList([makeFile("movie.mkv")]) },
    });

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("clears the selection on remove and allows re-selecting", async () => {
    const wrapper = mountPicker(makeFile("first.flac", 2048));
    expect(wrapper.text()).toContain("first.flac");
    expect(wrapper.text()).toContain("0.00 MiB");

    await wrapper.find("button").trigger("click");
    expect(lastEmittedValue(wrapper)).toBeNull();
    expect(wrapper.text()).toContain("选择文件");

    await chooseFiles(wrapper, [makeFile("second.m4a")]);
    expect((lastEmittedValue(wrapper) as File).name).toBe("second.m4a");
  });
});
