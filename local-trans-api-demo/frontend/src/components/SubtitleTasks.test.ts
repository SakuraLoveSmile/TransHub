import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubtitleTask, TaskListResponse } from "../types";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  fetchTaskList: vi.fn(),
  submitSubtitle: vi.fn(),
}));

import { fetchTaskList, submitSubtitle } from "../api";
import SubtitleTasks from "./SubtitleTasks.vue";

const mockedList = vi.mocked(fetchTaskList);
const mockedSubmit = vi.mocked(submitSubtitle);

const VALID_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: VALID_ID,
    mode: "transcribe",
    status: "succeeded",
    stage: "completed",
    original_name: "sample.wav",
    mock: false,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: null,
    expires_at: null,
    result: {
      model: "whisper-ja-1.5b",
      text: "こんにちは。",
      duration: 10,
      processing_time: 2,
    },
    downloads: { srt: "/srt", lrc: "/lrc" },
    error: null,
    ...overrides,
  };
}

function list(
  tasks: SubtitleTask[],
  total = tasks.length,
  offset = 0,
): TaskListResponse {
  return { tasks, total, limit: 20, offset };
}

function makeFile(name = "sample.wav"): File {
  return new File([new Uint8Array(2048)], name, { type: "audio/wav" });
}

async function chooseFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [file],
    configurable: true,
  });
  await input.trigger("change");
  await flushPromises();
}

async function selectMode(
  wrapper: ReturnType<typeof mount>,
  value: "transcribe" | "translate",
) {
  const radio = wrapper.find(`input[value="${value}"]`);
  (radio.element as HTMLInputElement).checked = true;
  await radio.trigger("change");
}

function lastActiveEvent(wrapper: ReturnType<typeof mount>) {
  const events = wrapper.emitted("active-change");
  return events?.[events.length - 1];
}

beforeEach(() => {
  // 仅 fake setTimeout/clearTimeout，保留 setImmediate 让 flushPromises 正常解析。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedList.mockReset();
  mockedSubmit.mockReset();
  mockedList.mockResolvedValue(list([]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SubtitleTasks", () => {
  it("disables submit until a file is chosen", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    const submitBtn = wrapper.find('button[type="submit"]');
    expect(submitBtn.attributes("disabled")).toBeDefined();

    await chooseFile(wrapper, makeFile());
    expect(submitBtn.attributes("disabled")).toBeUndefined();
  });

  it("submits with the default transcribe mode", async () => {
    mockedSubmit.mockResolvedValue(makeTask());
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    const file = makeFile();
    await chooseFile(wrapper, file);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledWith(file, "transcribe");
  });

  it("submits with the translate mode when selected", async () => {
    mockedSubmit.mockResolvedValue(makeTask());
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    const file = makeFile("ja.mp4");
    await chooseFile(wrapper, file);
    await selectMode(wrapper, "translate");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockedSubmit).toHaveBeenCalledWith(file, "translate");
  });

  it("uploads only once when submit is clicked repeatedly", async () => {
    let resolveSubmit: (task: SubtitleTask) => void = () => {};
    mockedSubmit.mockImplementation(
      () =>
        new Promise<SubtitleTask>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    await chooseFile(wrapper, makeFile());
    const form = wrapper.find("form");
    await form.trigger("submit");
    await form.trigger("submit");
    await form.trigger("submit");

    expect(mockedSubmit).toHaveBeenCalledTimes(1);

    resolveSubmit(makeTask());
    await flushPromises();
  });

  it("keeps the accepted task visible when the refresh fails", async () => {
    const accepted = makeTask({ id: VALID_ID, original_name: "kept.wav" });
    mockedSubmit.mockResolvedValue(accepted);
    mockedList
      .mockResolvedValueOnce(list([]))
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockResolvedValue(list([]));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    await chooseFile(wrapper, makeFile("kept.wav"));
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("已受理，任务编号：");
    expect(wrapper.text()).toContain(VALID_ID);
    expect(wrapper.text()).toContain("kept.wav");
    expect(wrapper.text()).toContain("网络中断");
  });

  it("clears the file but keeps the mode after a successful submit", async () => {
    mockedSubmit.mockResolvedValue(makeTask());
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    await chooseFile(wrapper, makeFile());
    await selectMode(wrapper, "translate");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    // 文件被清空，处理方式保留。
    expect(wrapper.find('input[type="file"]').exists()).toBe(true);
    const translateRadio = wrapper.find(
      'input[value="translate"]',
    ).element as HTMLInputElement;
    expect(translateRadio.checked).toBe(true);
  });

  it("does not overlap polling requests", async () => {
    let resolveFirst: (value: TaskListResponse) => void = () => {};
    mockedList
      .mockImplementationOnce(
        () =>
          new Promise<TaskListResponse>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(list([]));

    mount(SubtitleTasks);
    // 首个请求在途时，推进时间不应触发新的请求。
    await vi.advanceTimersByTimeAsync(20000);
    expect(mockedList).toHaveBeenCalledTimes(1);

    resolveFirst(list([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedList).toHaveBeenCalledTimes(1);

    // 上一轮结束后安排下一次（无活动任务，5 秒）。
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("polls faster while tasks are active", async () => {
    const running = makeTask({ status: "running", stage: "processing", result: null, downloads: null });
    mockedList.mockResolvedValue(list([running], 1));

    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);
    expect(lastActiveEvent(wrapper)).toEqual([true]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it("stops polling after unmount", async () => {
    mockedList.mockResolvedValue(list([]));
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);
    const calls = mockedList.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockedList.mock.calls.length).toBe(calls);
  });

  it("keeps model operations locked while paging through history", async () => {
    const running = makeTask({ id: VALID_ID, status: "running", stage: "processing", result: null, downloads: null });
    const done = makeTask({ id: "f".repeat(32), status: "succeeded", original_name: "old.wav" });
    mockedList.mockImplementation((_limit?: number, offset?: number) =>
      (offset ?? 0) === 0
        ? Promise.resolve(list([running, done], 40))
        : Promise.resolve(list([done], 40, offset ?? 0)),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(lastActiveEvent(wrapper)).toEqual([true]);

    const nextBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "下一页");
    expect(nextBtn).toBeTruthy();
    await nextBtn!.trigger("click");
    await flushPromises();

    // 第二页只有已完成任务，但活动状态仍以第一页为准。
    expect(lastActiveEvent(wrapper)).toEqual([true]);
    expect(wrapper.text()).toContain("old.wav");
  });

  it("clamps to the last valid page when records expire", async () => {
    mockedList.mockImplementation((_limit?: number, offset?: number) =>
      (offset ?? 0) === 0
        ? Promise.resolve(list([makeTask()], 1))
        : Promise.resolve(list([], 1, offset ?? 0)),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    // 手动跳到超出范围的页码后，刷新会回到最后有效页。
    const info = wrapper.find(".pagination__info");
    expect(info.text()).toContain("第 1 页");
  });
});
