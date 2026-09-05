import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubtitleTask, TaskListResponse } from "../api";

const { submitSubtitle, fetchTaskList } = vi.hoisted(() => ({
  submitSubtitle: vi.fn(),
  fetchTaskList: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    submitSubtitle,
    fetchTaskList,
  };
});

import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTasks from "./SubtitleTasks.vue";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "queued",
    stage: "queued",
    original_name: "a.flac",
    mock: false,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: null,
    expires_at: null,
    result: null,
    downloads: null,
    error: null,
    ...overrides,
  };
}

function page(tasks: SubtitleTask[], total = tasks.length): TaskListResponse {
  return { tasks, total, limit: 20, offset: 0 };
}

function makeFile(): File {
  return new File(["x".repeat(16)], "voice.flac");
}

async function mountWithFile() {
  const wrapper = mount(SubtitleTasks);
  await flushPromises();
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [makeFile()],
    configurable: true,
  });
  await input.trigger("change");
  return wrapper;
}

async function pickMode(wrapper: ReturnType<typeof mount>, value: string) {
  const radio = wrapper
    .findAll('input[type="radio"]')
    .find((r) => (r.element as HTMLInputElement).value === value);
  await radio?.setValue();
}

beforeEach(() => {
  fetchTaskList.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SubtitleTasks", () => {
  it("loads the first page on mount and shows the empty state", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    expect(fetchTaskList).toHaveBeenCalledWith(20, 0);
    expect(wrapper.text()).toContain("暂无任务");
    expect(wrapper.emitted("active-change")?.slice(-1)[0]).toStrictEqual([
      false,
    ]);
  });

  it("submits with the selected mode and params", async () => {
    submitSubtitle.mockResolvedValue(makeTask({ id: "a".repeat(32) }));
    const wrapper = await mountWithFile();

    await pickMode(wrapper, "translate");
    await wrapper.find("button.button-primary").trigger("click");
    await flushPromises();

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    const [fileArg, modeArg] = submitSubtitle.mock.calls[0];
    expect(modeArg).toBe("translate");
    expect((fileArg as File).name).toBe("voice.flac");
    expect(wrapper.text()).toContain("已受理，任务编号：");
  });

  it("ignores rapid double clicks with a single upload", async () => {
    submitSubtitle.mockResolvedValue(makeTask({ id: "b".repeat(32) }));
    const wrapper = await mountWithFile();

    await wrapper.find("button.button-primary").trigger("click");
    await wrapper.find("button.button-primary").trigger("click");
    await flushPromises();

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
  });

  it("keeps the accepted task visible when the refresh fails", async () => {
    submitSubtitle.mockResolvedValue(makeTask({ id: "c".repeat(32) }));
    fetchTaskList
      .mockResolvedValueOnce(page([]))
      .mockRejectedValue(new Error("网络错误"));
    const wrapper = await mountWithFile();

    await wrapper.find("button.button-primary").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已受理，任务编号：");
    expect(wrapper.text()).toContain("任务列表刷新失败");
  });

  it("keeps the file and shows the API error when submit fails", async () => {
    submitSubtitle.mockRejectedValue(new Error("队列已满"));
    const wrapper = await mountWithFile();

    await wrapper.find("button.button-primary").trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("队列已满");
    expect(wrapper.text()).toContain("voice.flac");
    expect(wrapper.text()).not.toContain("正在上传…");
  });

  it("emits active-change from the first page even when viewing history", async () => {
    fetchTaskList.mockImplementation(async (_limit: number, offset: number) => {
      if (offset === 0) {
        return page([makeTask({ status: "running", stage: "processing" })], 25);
      }
      return {
        tasks: [makeTask({ status: "succeeded", stage: "completed" })],
        total: 25,
        limit: 20,
        offset,
      };
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(wrapper.emitted("active-change")?.slice(-1)[0]).toStrictEqual([true]);

    // 翻到第二页，活动状态仍以第一页为依据。
    const next = wrapper
      .findAll("button")
      .find((b) => b.text() === "下一页");
    await next?.trigger("click");
    await flushPromises();

    expect(fetchTaskList).toHaveBeenLastCalledWith(20, 20);
    expect(wrapper.emitted("active-change")?.slice(-1)[0]).toStrictEqual([true]);
    expect(wrapper.text()).toContain("第 2 页");
  });

  it("respects the refreshed delay and stops polling after unmount", async () => {
    vi.useFakeTimers();
    fetchTaskList.mockResolvedValue(
      page([makeTask({ status: "running", stage: "processing" })]),
    );

    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    const callsAtMount = fetchTaskList.mock.calls.length;

    // 有活动任务 → 2 秒后再次刷新。
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(fetchTaskList.mock.calls.length).toBeGreaterThan(callsAtMount);

    wrapper.unmount();
    const callsAtUnmount = fetchTaskList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();
    expect(fetchTaskList.mock.calls.length).toBe(callsAtUnmount);
  });

  it("renders MediaFilePicker inside the create panel", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(wrapper.findComponent(MediaFilePicker).exists()).toBe(true);
    expect(wrapper.text()).toContain("将音视频拖到这里");
  });
});