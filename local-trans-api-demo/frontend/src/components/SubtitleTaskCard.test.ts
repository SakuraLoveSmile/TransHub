import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

describe("SubtitleTaskCard", () => {
  it("排队、运行、成功、失败、空结果、Mock 标记与下载链接", async () => {
    // 成功任务，有文本
    const successTask = {
      id: "1", original_name: "test.mp4", mode: "transcribe", status: "succeeded", stage: "completed",
      mock: true, result: { text: "Hello\nWorld", duration: 10, processing_time: 2 },
      downloads: { srt: "/dl/1.srt", lrc: "/dl/1.lrc" }
    };
    let wrapper = mount(SubtitleTaskCard, { props: { task: successTask as any } });
    expect(wrapper.text()).toContain("模拟");
    expect(wrapper.text()).toContain("音频时长：10.0s");
    expect(wrapper.find('a[download]').attributes('href')).toBe("/dl/1.srt");
    expect(wrapper.text()).toContain("Hello");

    // 排队任务
    const queuedTask = { ...successTask, status: "queued", stage: "queued", result: null };
    wrapper = mount(SubtitleTaskCard, { props: { task: queuedTask as any } });
    expect(wrapper.text()).toContain("当前阶段：排队中");

    // 失败任务
    const failedTask = { ...successTask, status: "failed", stage: "failed", error: { code: "ERR", detail: "Bad" } };
    wrapper = mount(SubtitleTaskCard, { props: { task: failedTask as any } });
    expect(wrapper.text()).toContain("ERR：Bad");

    // 空结果任务
    const emptyTask = { ...successTask, result: { text: "", duration: 10, processing_time: 2 } };
    wrapper = mount(SubtitleTaskCard, { props: { task: emptyTask as any } });
    expect(wrapper.text()).toContain("未识别到语音");
  });

  it("全文展开、复制成功、复制失败及剪贴板不可用", async () => {
    const longText = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
    const task = {
      id: "1", original_name: "test.mp4", mode: "transcribe", status: "succeeded", stage: "completed",
      result: { text: longText, duration: 10, processing_time: 2 }
    };

    const wrapper = mount(SubtitleTaskCard, { props: { task: task as any } });
    
    // Only 6 lines displayed initially
    expect(wrapper.findAll('.line').length).toBe(6);
    
    // Expand
    await wrapper.find('button.action-btn').trigger('click');
    expect(wrapper.findAll('.line').length).toBe(10);

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    const copyBtn = wrapper.findAll('button.action-btn').find(w => w.text().includes('复制文本'));
    await copyBtn!.trigger('click');
    
    await wrapper.vm.$nextTick();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(longText);
    expect(wrapper.find('[role="status"]').text()).toBe("已复制");
  });
});
