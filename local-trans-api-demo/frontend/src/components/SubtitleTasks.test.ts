import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTasks from "./SubtitleTasks.vue";
import type { SubtitleTask, TaskListResponse } from "../types";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败",
  fetchTaskList: vi.fn(),
  submitSubtitle: vi.fn(),
}));

import { fetchTaskList, submitSubtitle } from "../api";

const mockedFetchTaskList = vi.mocked(fetchTaskList);
const mockedSubmitSubtitle = vi.mocked(submitSubtitle);

function taskId(value: string): string {
  return value.repeat(32).slice(0, 32);
}

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: taskId("a"),
    mode: "transcribe",
    status: "queued",
    stage: "queued",
    original_name: "sample.flac",
    mock: true,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: null,
    expires_at: null,
    result: null,
    downloads: null,
    error: null,
    ...overrides,
  };
}

function page(
  tasks: SubtitleTask[] = [],
  total = tasks.length,
): TaskListResponse {
  return { tasks, total, limit: 20, offset: 0 };
}

async function chooseFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper
    .findComponent(MediaFilePicker)
    .find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
  await input.trigger("change");
}

describe("SubtitleTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedFetchTaskList.mockResolvedValue(page());
    mockedSubmitSubtitle.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses native radio modes and submits only once while locked", async () => {
    const file = new File(["audio"], "episode.mp3", { type: "audio/mpeg" });
    const accepted = makeTask({
      id: taskId("b"),
      original_name: file.name,
      mode: "translate",
    });
    let resolveSubmit!: (value: SubtitleTask) => void;
    mockedSubmitSubtitle.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, file);
    await wrapper.find('input[type="radio"][value="translate"]').setValue(true);

    const form = wrapper.find("form");
    const firstSubmit = form.trigger("submit");
    const secondSubmit = form.trigger("submit");
    await wrapper.vm.$nextTick();

    expect(mockedSubmitSubtitle).toHaveBeenCalledTimes(1);
    expect(mockedSubmitSubtitle).toHaveBeenCalledWith(file, "translate");
    expect(form.find('button[type="submit"]').text()).toContain("正在上传");
    expect(wrapper.findComponent(MediaFilePicker).props("disabled")).toBe(true);

    resolveSubmit(accepted);
    await firstSubmit;
    await secondSubmit;
    await flushPromises();

    expect(wrapper.findComponent(MediaFilePicker).props("modelValue")).toBeNull();
    expect(
      wrapper.find('input[type="radio"][value="translate"]').element,
    ).toHaveProperty("checked", true);
    expect(wrapper.text()).toContain(accepted.id);
    wrapper.unmount();
  });

  it("keeps the file and selected mode when submission fails", async () => {
    const file = new File(["audio"], "episode.wav");
    mockedSubmitSubtitle.mockRejectedValueOnce(
      new Error("QUEUE_FULL：等待队列已满，请稍后重试。"),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, file);
    await wrapper.find('input[type="radio"][value="translate"]').setValue(true);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("QUEUE_FULL");
    expect(wrapper.findComponent(MediaFilePicker).props("modelValue")).toBe(file);
    expect(
      wrapper.find('input[type="radio"][value="translate"]').element,
    ).toHaveProperty("checked", true);
    wrapper.unmount();
  });

  it("keeps an accepted task visible when the follow-up refresh fails", async () => {
    const file = new File(["audio"], "accepted.m4a");
    const accepted = makeTask({
      id: taskId("c"),
      original_name: file.name,
      status: "queued",
    });
    mockedFetchTaskList
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error("服务暂不可用"));
    mockedSubmitSubtitle.mockResolvedValueOnce(accepted);

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, file);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".task-card").text()).toContain(file.name);
    expect(wrapper.find('[role="alert"]').text()).toContain("已保留现有记录");
    expect(wrapper.text()).toContain(accepted.id);
    wrapper.unmount();
  });

  it("uses the first page for activity even while showing a history page", async () => {
    const active = makeTask({ id: taskId("d"), status: "running", stage: "processing" });
    const historical = makeTask({
      id: taskId("e"),
      status: "succeeded",
      stage: "completed",
      result: {
        model: "whisper-ja-1.5b",
        text: "字幕结果",
        duration: 12,
        processing_time: 2,
      },
      downloads: { srt: "/result.srt", lrc: "/result.lrc" },
    });
    mockedFetchTaskList.mockImplementation(async (_limit, offset) =>
      offset === 0 ? page([active], 21) : { ...page([historical], 21), offset: 20 },
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    const nextButton = wrapper.findAll("button").find((button) => button.text() === "下一页");
    expect(nextButton).toBeDefined();
    await nextButton!.trigger("click");
    await flushPromises();

    expect(wrapper.find(".task-card").text()).toContain("字幕结果");
    const activeEvents = wrapper.emitted("active-change");
    expect(activeEvents?.[activeEvents.length - 1]).toEqual([true]);
    expect(mockedFetchTaskList).toHaveBeenCalledWith(20, 0);
    expect(mockedFetchTaskList).toHaveBeenCalledWith(20, 20);
    wrapper.unmount();
  });

  it("does not overlap polling and stops scheduling after unmount", async () => {
    let resolveFirst!: (value: TaskListResponse) => void;
    mockedFetchTaskList.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const wrapper = mount(SubtitleTasks);
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(10000);
    expect(mockedFetchTaskList).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    resolveFirst(page());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockedFetchTaskList).toHaveBeenCalledTimes(1);
  });

  it("returns to the last valid page after older records expire", async () => {
    const current = makeTask({ id: taskId("f"), status: "succeeded", stage: "completed" });
    mockedFetchTaskList.mockImplementation(async (_limit, offset) => {
      if (offset === 0) {
        return page([current], 21);
      }
      return { ...page([], 20), offset: 20 };
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    const nextButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "下一页");
    expect(nextButton).toBeDefined();
    await nextButton!.trigger("click");
    await flushPromises();

    mockedFetchTaskList.mockImplementation(async (_limit, offset) => {
      expect(offset).toBe(0);
      return page([current], 20);
    });
    const refreshButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "刷新");
    expect(refreshButton).toBeDefined();
    await refreshButton!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("第 1 页");
    expect(wrapper.find(".task-card").text()).toContain(current.original_name);
    wrapper.unmount();
  });
});
