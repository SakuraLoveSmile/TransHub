import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";

describe("MediaFilePicker", () => {
  it("正常选文件、空文件、错误扩展名、多文件拖入、移除后重新选择", async () => {
    const wrapper = mount(MediaFilePicker, {
      props: {
        modelValue: null,
        disabled: false,
        'onUpdate:modelValue': (e: any) => wrapper.setProps({ modelValue: e })
      }
    });

    const fileInput = wrapper.find('input[type="file"]');
    
    // 正常选文件
    const validFile = new File(["dummy content"], "test.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput.element, 'files', {
      value: [validFile],
      configurable: true
    });
    await fileInput.trigger('change');
    expect(wrapper.props('modelValue')).toEqual(validFile);

    // 移除文件
    await wrapper.find('.remove-btn').trigger('click');
    expect(wrapper.props('modelValue')).toBeNull();

    // 空文件
    const emptyFile = new File([], "empty.mp4", { type: "video/mp4" });
    Object.defineProperty(fileInput.element, 'files', { value: [emptyFile], configurable: true });
    await fileInput.trigger('change');
    expect(wrapper.find('.error-msg').text()).toContain("文件为空");
    expect(wrapper.props('modelValue')).toBeNull();

    // 错误扩展名
    const txtFile = new File(["text"], "test.txt", { type: "text/plain" });
    Object.defineProperty(fileInput.element, 'files', { value: [txtFile], configurable: true });
    await fileInput.trigger('change');
    expect(wrapper.find('.error-msg').text()).toContain("暂不支持");

    // 多文件拖入
    const dataTransfer = {
      files: [validFile, validFile]
    };
    await wrapper.find('.file-picker').trigger('drop', { dataTransfer });
    expect(wrapper.find('.error-msg').text()).toContain("一次请选择一个");
  });
});
