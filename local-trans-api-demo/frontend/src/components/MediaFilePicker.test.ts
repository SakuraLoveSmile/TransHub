import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function makeFile(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name);
}

function asFileList(files: File[]): FileList {
  const list = files.slice() as unknown as FileList;
  Object.defineProperty(list, "item", {
    value: (index: number) => files[index] ?? null,
  });
  return list;
}

function mountPicker(disabled = false, file: File | null = null) {
  return mount(MediaFilePicker, {
    props: { disabled, modelValue: file },
  });
}

async function selectViaInput(
  wrapper: ReturnType<typeof mountPicker>,
  files: File[],
) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: asFileList(files),
    configurable: true,
  });
  await input.trigger("change");
}

function lastModelUpdate(wrapper: ReturnType<typeof mountPicker>) {
  const events = wrapper.emitted("update:modelValue");
  if (!events || events.length === 0) return undefined;
  return events[events.length - 1][0];
}

function findButton(wrapper: ReturnType<typeof mountPicker>, label: string) {
  const button = wrapper
    .findAll("button")
    .find((item) => item.text() === label);
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

describe("MediaFilePicker", () => {
  it("accepts a single supported file picked from disk", async () => {
    const wrapper = mountPicker();
    const file = makeFile("episode-01.wav");

    await selectViaInput(wrapper, [file]);

    expect(lastModelUpdate(wrapper)).toBe(file);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("rejects an empty file without emitting it", async () => {
    const wrapper = mountPicker();

    await selectViaInput(wrapper, [makeFile("empty.mp4", 0)]);

    expect(wrapper.find('[role="alert"]').text()).toBe("文件为空，请重新选择。");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("rejects an unsupported extension", async () => {
    const wrapper = mountPicker();

    await selectViaInput(wrapper, [makeFile("notes.txt")]);

    expect(wrapper.find('[role="alert"]').text()).toBe(
      "暂不支持这个文件格式，请选择音频或视频文件。",
    );
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("rejects a drop carrying more than one file", async () => {
    const wrapper = mountPicker();

    await wrapper
      .find(".file-picker")
      .trigger("drop", { dataTransfer: { files: asFileList([makeFile("a.wav"), makeFile("b.wav")]) } });

    expect(wrapper.find('[role="alert"]').text()).toBe(
      "一次请选择一个音视频文件。",
    );
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("accepts a dropped file and highlights the area while dragging", async () => {
    const wrapper = mountPicker();
    const file = makeFile("interview.mkv");

    await wrapper.find(".file-picker").trigger("dragenter");
    expect(wrapper.find(".file-picker").classes()).toContain("is-dragging");

    await wrapper
      .find(".file-picker")
      .trigger("drop", { dataTransfer: { files: asFileList([file]) } });

    expect(lastModelUpdate(wrapper)).toBe(file);
    expect(wrapper.find(".file-picker").classes()).not.toContain("is-dragging");
  });

  it("clears the selection and allows picking a new file afterwards", async () => {
    const wrapper = mountPicker();
    const first = makeFile("first.wav", 3 * 1024 * 1024);
    await selectViaInput(wrapper, [first]);
    await wrapper.setProps({ modelValue: first });

    expect(wrapper.find(".file-name").text()).toBe("first.wav");
    expect(wrapper.text()).toContain("3.00 MiB");

    await findButton(wrapper, "移除文件").trigger("click");
    expect(lastModelUpdate(wrapper)).toBeNull();

    await wrapper.setProps({ modelValue: null });
    const second = makeFile("second.mp3");
    await selectViaInput(wrapper, [second]);
    expect(lastModelUpdate(wrapper)).toBe(second);
  });

  it("associates the validation message with the picker for screen readers", async () => {
    const wrapper = mountPicker();

    await selectViaInput(wrapper, [makeFile("sheet.pdf")]);

    const alert = wrapper.find('[role="alert"]');
    expect(alert.attributes("id")).toBe("file-picker-error");
    expect(wrapper.find(".file-picker").attributes("aria-describedby")).toBe(
      "file-picker-error",
    );
  });

  it("locks the controls and ignores drops while disabled", async () => {
    const wrapper = mountPicker(true);
    const file = makeFile("locked.wav");

    expect(wrapper.find('input[type="file"]').attributes("disabled")).toBeDefined();

    await wrapper
      .find(".file-picker")
      .trigger("drop", { dataTransfer: { files: asFileList([file]) } });

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.find(".file-picker").trigger("dragenter");
    expect(wrapper.find(".file-picker").classes()).not.toContain("is-dragging");
  });
});
