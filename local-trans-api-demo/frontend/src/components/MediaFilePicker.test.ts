import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

function mountPicker() {
  return mount(MediaFilePicker, {
    props: {
      disabled: false,
      modelValue: null,
    },
  });
}

async function changeFile(wrapper: ReturnType<typeof mount>, files: File[]) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: files,
  });
  await input.trigger("change");
}

describe("MediaFilePicker", () => {
  it("accepts a supported file and can remove it", async () => {
    const wrapper = mountPicker();
    const file = new File(["audio"], "声track.MP3", { type: "audio/mpeg" });

    await changeFile(wrapper, [file]);
    const selectedEvents = wrapper.emitted("update:modelValue");
    expect(selectedEvents?.[selectedEvents.length - 1]).toEqual([file]);
    expect(wrapper.text()).toContain(file.name);
    expect(wrapper.text()).toContain("0.00 MiB");

    await wrapper.find(".file-remove").trigger("click");
    const removedEvents = wrapper.emitted("update:modelValue");
    expect(removedEvents?.[removedEvents.length - 1]).toEqual([null]);
  });

  it("reports empty, unsupported, and multiple-file selections", async () => {
    const cases = [
      {
        files: [new File([], "empty.wav")],
        message: "文件为空",
      },
      {
        files: [new File(["data"], "notes.txt")],
        message: "暂不支持",
      },
      {
        files: [new File(["a"], "one.wav"), new File(["b"], "two.wav")],
        message: "一次请选择一个",
      },
    ];

    for (const item of cases) {
      const wrapper = mountPicker();
      await changeFile(wrapper, item.files);
      expect(wrapper.find('[role="alert"]').text()).toContain(item.message);
      expect(wrapper.findComponent(MediaFilePicker).props("modelValue")).toBeNull();
      wrapper.unmount();
    }
  });

  it("supports drag highlight and validates dropped files", async () => {
    const wrapper = mountPicker();
    const file = new File(["audio"], "drop.flac");

    await wrapper.trigger("dragover");
    expect(wrapper.classes()).toContain("is-dragging");
    await wrapper.trigger("drop", { dataTransfer: { files: [file] } });
    expect(wrapper.classes()).not.toContain("is-dragging");
    const droppedEvents = wrapper.emitted("update:modelValue");
    expect(droppedEvents?.[droppedEvents.length - 1]).toEqual([file]);

    await wrapper.trigger("dragover");
    await wrapper.trigger("drop", {
      dataTransfer: { files: [new File(["a"], "a.wav"), new File(["b"], "b.wav")] },
    });
    expect(wrapper.find('[role="alert"]').text()).toContain("一次请选择一个");
  });

  it("does not accept files while disabled", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: { disabled: true, modelValue: null },
    });
    const file = new File(["audio"], "locked.wav");

    await wrapper.trigger("drop", { dataTransfer: { files: [file] } });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.find('input[type="file"]').attributes("disabled")).toBeDefined();
  });
});
