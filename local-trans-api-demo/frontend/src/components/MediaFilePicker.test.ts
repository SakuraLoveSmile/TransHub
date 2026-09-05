import { h, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

// 用真实父组件承载 v-model，验证 MediaFilePicker 的数据契约。
function mountPicker(disabled = false) {
  const file = ref<File | null>(null);
  const Parent = {
    setup() {
      return () =>
        h(MediaFilePicker, {
          disabled,
          modelValue: file.value,
          "onUpdate:modelValue": (value: File | null) => {
            file.value = value;
          },
        });
    },
  };
  const wrapper = mount(Parent);
  return { wrapper, getFile: () => file.value };
}

function makeFile(name: string, size: number): File {
  return new File(["x".repeat(Math.max(size, 1))], name);
}

async function chooseFiles(
  wrapper: VueWrapper,
  files: File[],
): Promise<void> {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: files,
    configurable: true,
  });
  await input.trigger("change");
}

describe("MediaFilePicker", () => {
  it("accepts a valid file and shows its summary", async () => {
    const { wrapper, getFile } = mountPicker();

    const wav = makeFile("voice.wav", 2048);
    await chooseFiles(wrapper, [wav]);

    expect(getFile()?.name).toBe("voice.wav");
    expect(wrapper.text()).toContain("voice.wav");
    expect(wrapper.text()).toContain("MiB");
  });

  it("rejects an empty file with an alert", async () => {
    const { wrapper, getFile } = mountPicker();

    const empty = new File([], "empty.mp3");
    await chooseFiles(wrapper, [empty]);

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("文件为空");
    expect(getFile()).toBeNull();
  });

  it("rejects unsupported extensions", async () => {
    const { wrapper, getFile } = mountPicker();

    await chooseFiles(wrapper, [makeFile("doc.txt", 10)]);

    expect(wrapper.find('[role="alert"]').text()).toContain("暂不支持");
    expect(getFile()).toBeNull();
  });

  it("rejects multiple dropped files", async () => {
    const { wrapper, getFile } = mountPicker();

    await wrapper.find(".file-picker").trigger("drop", {
      dataTransfer: { files: [makeFile("a.mp3", 10), makeFile("b.mp3", 10)] },
    });

    expect(wrapper.find('[role="alert"]').text()).toContain("一次请选择一个");
    expect(getFile()).toBeNull();
  });

  it("removes the selected file and allows reselect", async () => {
    const { wrapper, getFile } = mountPicker();

    await chooseFiles(wrapper, [makeFile("voice.mp3", 10)]);
    expect(getFile()?.name).toBe("voice.mp3");

    await wrapper.find('button[type="button"]').trigger("click");
    expect(getFile()).toBeNull();
    expect(wrapper.text()).toContain("选择文件");

    const again = makeFile("again.flac", 10);
    await chooseFiles(wrapper, [again]);
    expect(getFile()?.name).toBe("again.flac");
  });
});