import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubtitleTasks from "./SubtitleTasks.vue";
import { makeTask, taskId } from "../testFixtures";
import type { SubtitleTask, TaskListResponse } from "../types";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchTaskList: vi.fn(),
    submitSubtitle: vi.fn(),
  };
});

const api = await import("../api");

const fetchTaskList = vi.mocked(api.fetchTaskList);
const submitSubtitle = vi.mocked(api.submitSubtitle);

function page(tasks: SubtitleTask[], total = tasks.length): TaskListResponse {
  return { tasks, total, limit: 20, offset: 0 };
}

function makeFile(name = "sample.wav", size = 1024): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

async function pickFile(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.get("input[type=file]");
  Object.defineProperty(input.element, "files", {
    value: [makeFile()],
    configurable: true,
  });
  await input.trigger("change");
  await flushPromises();
}

function lastActiveChange(wrapper: ReturnType<typeof mount>): unknown {
  const emitted = wrapper.emitted("active-change");
  return emitted?.[emitted.length - 1];
}

function submitButton(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes("生成字幕"));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchTaskList.mockReset();
  submitSubtitle.mockReset();
  fetchTaskList.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("SubtitleTasks 提交", () => {
  it("未选择文件时禁用提交", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(submitButton(wrapper)?.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("按选中的处理方式提交，受理后清空文件并回到第一页", async () => {
    const accepted = makeTask({
      id: taskId(1),
      status: "queued",
      stage: "queued",
      result: null,
      downloads: null,
    });
    submitSubtitle.mockResolvedValue(accepted);
    fetchTaskList.mockResolvedValue(page([accepted]));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    await pickFile(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    expect(submitSubtitle.mock.calls[0][1]).toBe("transcribe");
    expect(wrapper.text()).toContain("已受理，任务编号：");
    expect(wrapper.text()).toContain("将音视频拖到这里");

    // 再次选择文件并切换到“日语翻译成中文”后提交。
    await pickFile(wrapper);
    const radios = wrapper.findAll("input[type=radio]");
    await radios[1].setValue();
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(submitSubtitle).toHaveBeenCalledTimes(2);
    expect(submitSubtitle.mock.calls[1][1]).toBe("translate");
    wrapper.unmount();
  });

  it("连续点击只产生一次上传", async () => {
    submitSubtitle.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeTask()), 50)),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await pickFile(wrapper);

    const form = wrapper.get("form");
    void form.trigger("submit");
    void form.trigger("submit");
    void form.trigger("submit");
    await vi.advanceTimersByTimeAsync(80);
    await flushPromises();

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("提交失败时保留文件与模式并展示接口错误", async () => {
    submitSubtitle.mockRejectedValue(new Error("等待队列已满，请稍后重试。"));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await pickFile(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "等待队列已满，请稍后重试。",
    );
    expect(wrapper.text()).toContain("sample.wav");
    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    // 队列已满不自动重试。
    await vi.advanceTimersByTimeAsync(10000);
    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("受理成功但刷新失败时仍能看到刚受理的任务", async () => {
    const accepted = makeTask({
      id: taskId(2),
      status: "queued",
      stage: "queued",
      result: null,
      downloads: null,
      original_name: "accepted.wav",
    });

    fetchTaskList.mockResolvedValueOnce(page([]));
    submitSubtitle.mockResolvedValue(accepted);
    fetchTaskList.mockRejectedValueOnce(new Error("网络中断"));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    await pickFile(wrapper);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();

    expect(wrapper.text()).toContain("任务列表刷新失败");
    expect(wrapper.text()).toContain("accepted.wav");
    expect(lastActiveChange(wrapper)).toEqual([true]);
    wrapper.unmount();
  });
});

describe("SubtitleTasks 分页与轮询", () => {
  it("查看第二页时活动状态仍以第一页为准", async () => {
    const running = makeTask({
      id: taskId(3),
      status: "running",
      stage: "processing",
      result: null,
      downloads: null,
    });
    const history = Array.from({ length: 20 }, (_, index) =>
      makeTask({ id: taskId(100 + index), original_name: `old-${index}.wav` }),
    );

    fetchTaskList.mockImplementation(async (_limit = 20, offset = 0) => {
      if (offset === 0) return page([running, ...history.slice(0, 19)], 25);
      return { tasks: history.slice(19), total: 25, limit: 20, offset };
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(lastActiveChange(wrapper)).toEqual([true]);

    const nextPage = wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页");
    await nextPage!.trigger("click");
    await flushPromises();

    // 第二页全是历史任务，但模型操作仍需受限。
    expect(lastActiveChange(wrapper)).toEqual([true]);
    expect(wrapper.text()).toContain("第 2 页");
    wrapper.unmount();
  });

  it("当前页记录过期为空时回到最后一个有效页", async () => {
    let total = 25;
    fetchTaskList.mockImplementation(async (_limit = 20, offset = 0) => {
      if (offset === 0) {
        return page(
          Array.from({ length: 20 }, (_, index) =>
            makeTask({ id: taskId(200 + index) }),
          ),
          total,
        );
      }
      if (total === 25) {
        return page([makeTask({ id: taskId(220) })], total);
      }
      return page([], total);
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    const nextPage = wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页");
    await nextPage!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("第 2 页");

    // 记录过期：第二页清空，总数降到 20。
    total = 20;
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(wrapper.text()).toContain("第 1 页");
    expect(wrapper.findAll("li.task")).toHaveLength(20);
    wrapper.unmount();
  });

  it("轮询串行执行，不会重叠请求", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    fetchTaskList.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      inFlight -= 1;
      return page([]);
    });

    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(20000);
    await flushPromises();

    expect(maxInFlight).toBe(1);
    expect(fetchTaskList.mock.calls.length).toBeGreaterThan(1);
    wrapper.unmount();
  });

  it("组件卸载后不再发起请求", async () => {
    fetchTaskList.mockResolvedValue(page([]));
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    const callsBeforeUnmount = fetchTaskList.mock.calls.length;
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    await flushPromises();

    expect(fetchTaskList.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
