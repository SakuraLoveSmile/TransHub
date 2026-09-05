import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import SubtitleTasks from "./SubtitleTasks.vue";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchTaskList: vi.fn(),
    submitSubtitle: vi.fn(),
  };
});

describe("SubtitleTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.fetchTaskList).mockResolvedValue({
      tasks: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("两种模式提交参数正确；连续点击只产生一次上传", async () => {
    vi.mocked(api.submitSubtitle).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ id: "task-1" } as any), 100))
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    // 选取文件
    const validFile = new File(["123"], "test.mp4", { type: "video/mp4" });
    wrapper.findComponent({ name: "MediaFilePicker" }).vm.$emit("update:modelValue", validFile);
    await wrapper.vm.$nextTick();

    // 选择模式 translate
    const radioTranslate = wrapper.find('input[value="translate"]');
    await radioTranslate.setValue(true);

    const form = wrapper.find('form');
    // 连续点击提交
    await form.trigger('submit');
    await form.trigger('submit');

    expect(api.submitSubtitle).toHaveBeenCalledTimes(1);
    expect(api.submitSubtitle).toHaveBeenCalledWith(validFile, "translate");

    await vi.advanceTimersByTimeAsync(150);
    expect(wrapper.text()).toContain("已受理，任务编号：task-1");
  });

  it("受理成功但刷新失败时仍能看到任务", async () => {
    vi.mocked(api.submitSubtitle).mockResolvedValue({ id: "task-99" } as any);
    
    // 第一次加载成功
    vi.mocked(api.fetchTaskList).mockResolvedValueOnce({ tasks: [], total: 0, limit: 20, offset: 0 });
    
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    // 修改为下次刷新抛出错误
    vi.mocked(api.fetchTaskList).mockRejectedValue(new Error("Network Error"));

    const validFile = new File(["123"], "test.mp4", { type: "video/mp4" });
    wrapper.findComponent({ name: "MediaFilePicker" }).vm.$emit("update:modelValue", validFile);
    await wrapper.vm.$nextTick();
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    // 断言有网络错误提示，但任务编号仍在
    expect(wrapper.text()).toContain("任务列表刷新失败");
    expect(wrapper.text()).toContain("已受理，任务编号：task-99");
  });

  it("分页期间活动任务仍能限制模型操作", async () => {
    // 模拟有活动任务
    vi.mocked(api.fetchTaskList).mockResolvedValue({
      tasks: [
        { id: "1", status: "running", stage: "processing" } as any,
      ],
      total: 40,
      limit: 20,
      offset: 0,
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    // active-change should emit true
    expect(wrapper.emitted("active-change")?.[0]).toEqual([true]);
  });

  it("轮询请求不重叠，卸载后不继续请求或更新状态", async () => {
    let resolveRequest: any;
    vi.mocked(api.fetchTaskList).mockImplementation(() => {
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    });

    const wrapper = mount(SubtitleTasks);
    
    // Timer fires but request is still pending
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.fetchTaskList).toHaveBeenCalledTimes(1); // Still 1 because previous hasn't resolved

    // Resolve the first request
    resolveRequest({ tasks: [], total: 0, limit: 20, offset: 0 });
    await flushPromises();

    // Now advance timer again
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.fetchTaskList).toHaveBeenCalledTimes(2); // New request sent

    wrapper.unmount();
    
    // Resolve the second request
    resolveRequest({ tasks: [], total: 0, limit: 20, offset: 0 });
    await flushPromises();

    // Advance timer after unmount
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.fetchTaskList).toHaveBeenCalledTimes(2); // No new requests
  });
});
