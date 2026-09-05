import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function makeFile(name = "speech.wav", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "audio/wav" });
}

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(MediaFilePicker, { props: { modelValue: null, ...props } });
}

async function pick(wrapper: ReturnType<typeof mount>, files: File[]) {
  const input = wrapper.find("#media");
  const el = input.element as HTMLInputElement;
  Object.defineProperty(el, "files", { value: files, configurable: true });
  await input.trigger("change");
  await flushPromises();
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("MediaFilePicker", () => {
  it("accepts a valid media file via the input", async () => {
    const wrapper = mountPicker({ modelValue: null });
    const file = makeFile("speech.wav", 1024 * 1024);
    await pick(wrapper, [file]);
    expect(wrapper.text()).toContain("speech.wav");
    expect(wrapper.text()).toContain("1.00 MiB");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("rejects an empty file with a role=alert message", async () => {
    const wrapper = mountPicker();
    await pick(wrapper, [makeFile("empty.mp3", 0)]);
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("文件为空");
    expect(wrapper.text()).toContain("选择文件");
    wrapper.unmount();
  });

  it("rejects an unsupported extension", async () => {
    const wrapper = mountPicker();
    await pick(wrapper, [makeFile("notes.txt", 128)]);
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("暂不支持这个文件格式");
    expect(wrapper.text()).toContain("选择文件");
    wrapper.unmount();
  });

  it("rejects multiple files dropped at once and reports a single-file rule", async () => {
    const wrapper = mountPicker();
    const dataTransfer = {
      files: [makeFile("a.wav"), makeFile("b.mp3")],
    } as unknown as DataTransfer;
    await wrapper.find(".file-picker").trigger("drop", { dataTransfer });
    await flushPromises();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("一次请选择一个音视频文件");
    expect(wrapper.text()).toContain("选择文件");
    wrapper.unmount();
  });

  it("accepts a dropped single file and clears the error", async () => {
    const wrapper = mountPicker();
    await pick(wrapper, [makeFile("bad.txt")]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    const dataTransfer = { files: [makeFile("good.flac")] } as unknown as DataTransfer;
    await wrapper.find(".file-picker").trigger("drop", { dataTransfer });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("good.flac");
    wrapper.unmount();
  });

  it("removes the file and clears the error", async () => {
    const wrapper = mountPicker();
    await pick(wrapper, [makeFile("keep.mp4", 2048)]);
    expect(wrapper.text()).toContain("keep.mp4");
    const remove = wrapper.findAll("button").find((b) => b.text().includes("移除文件"))!;
    await remove.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("选择文件");
    expect(wrapper.text()).not.toContain("keep.mp4");
    wrapper.unmount();
  });

  it("can re-select the same file after removal (input value reset)", async () => {
    const wrapper = mountPicker();
    const file = makeFile("again.wav");
    await pick(wrapper, [file]);
    expect(wrapper.text()).toContain("again.wav");
    const remove = wrapper.findAll("button").find((b) => b.text().includes("移除文件"))!;
    await remove.trigger("click");
    await flushPromises();
    await pick(wrapper, [file]);
    expect(wrapper.text()).toContain("again.wav");
    wrapper.unmount();
  });

  it("ignores drop events while disabled", async () => {
    const wrapper = mountPicker({ disabled: true });
    const dataTransfer = { files: [makeFile("x.wav")] } as unknown as DataTransfer;
    await wrapper.find(".file-picker").trigger("drop", { dataTransfer });
    await flushPromises();
    expect(wrapper.text()).toContain("选择文件");
    const pickButton = wrapper.findAll("button").find((b) => b.text().includes("选择文件"))!;
    expect(pickButton.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("shows dragging highlight on dragover and clears it on dragleave", async () => {
    const wrapper = mountPicker();
    const zone = wrapper.find(".file-picker");
    await zone.trigger("dragover");
    expect(zone.classes()).toContain("is-dragging");
    await zone.trigger("dragleave");
    expect(zone.classes()).not.toContain("is-dragging");
    wrapper.unmount();
  });
});
