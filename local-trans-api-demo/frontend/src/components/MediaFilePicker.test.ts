import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function audioFile(name = "sample.flac", size = 3): File {
  return new File([new Uint8Array(size)], name);
}

function setInputFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

describe("MediaFilePicker", () => {
  it("接受一个合法音视频文件并通过 v-model 返回", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, disabled: false },
    });
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    const file = audioFile();
    setInputFiles(input, [file]);
    await wrapper.find('input[type="file"]').trigger("change");

    const events = wrapper.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events![0][0]).toBe(file);
  });

  it("拒绝空文件并提示", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, disabled: false },
    });
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    setInputFiles(input, [audioFile("empty.wav", 0)]);
    await wrapper.find('input[type="file"]').trigger("change");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.find('[role="alert"]').text()).toBe("文件为空，请重新选择。");
  });

  it("拒绝不支持的扩展名", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, disabled: false },
    });
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    setInputFiles(input, [audioFile("notes.txt")]);
    await wrapper.find('input[type="file"]').trigger("change");

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.find('[role="alert"]').text()).toBe(
      "暂不支持这个文件格式，请选择音频或视频文件。",
    );
  });

  it("拖入多个文件时提示只选一个", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, disabled: false },
    });
    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: { files: [audioFile("a.mp3"), audioFile("b.mp4")] },
    });

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.find('[role="alert"]').text()).toBe(
      "一次请选择一个音视频文件。",
    );
  });

  it("拖入单个文件成功并展示文件摘要", async () => {
    const file = audioFile("ドラマ第一話.m4a", 1024);
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: file, disabled: false },
    });

    expect(wrapper.find(".file-name").text()).toBe("ドラマ第一話.m4a");
    expect(wrapper.find(".file-meta").text()).toContain("MiB");
  });

  it("移除文件后清空选择并允许重新选择", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: audioFile(), disabled: false },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBeNull();

    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    const next = audioFile("next.opus");
    setInputFiles(input, [next]);
    await wrapper.find('input[type="file"]').trigger("change");
    expect(wrapper.emitted("update:modelValue")![1][0]).toBe(next);
  });

  it("拖入时高亮，离开时取消高亮", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, disabled: false },
    });
    const picker = wrapper.find(".file-picker");
    await picker.trigger("dragenter");
    expect(picker.classes()).toContain("is-dragover");
    await picker.trigger("dragleave");
    expect(picker.classes()).not.toContain("is-dragover");
  });

  it("禁用时忽略拖入且按钮不可用", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { modelValue: null, disabled: true },
    });
    const picker = wrapper.find(".file-picker");
    await picker.trigger("dragenter");
    expect(picker.classes()).not.toContain("is-dragover");
    await picker.trigger("drop", {
      dataTransfer: { files: [audioFile()] },
    });
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
  });
});
