import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchTaskList,
  submitSubtitle,
  type SubtitleTask,
  type TaskListResponse,
} from "../api";
import MediaFilePicker from "./MediaFilePicker.vue";
import SubtitleTasks from "./SubtitleTasks.vue";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  fetchTaskList: vi.fn(),
  submitSubtitle: vi.fn(),
}));

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: `${"a".repeat(29)}001`,
    mode: "transcribe",
    status: "succeeded",
    stage: "completed",
    original_name: "older.wav",
    mock: false,
    created_at: "",
    finished_at: null,
    expires_at: null,
    result: { model: "m", text: "旧结果", duration: 1, processing_time: 1 },
    downloads: null,
    error: null,
    ...overrides,
  };
}

function makeList(
  tasks: SubtitleTask[],
  total = tasks.length,
  offset = 0,
): TaskListResponse {
  return { tasks, total, limit: 20, offset };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buttonByText(wrapper: VueWrapper, label: string) {
  const button = wrapper
    .findAll("button")
    .find((item) => item.text() === label);
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

async function pickFile(wrapper: VueWrapper, name = "clip.wav") {
  const file = new File([new Uint8Array(2048)], name);
  await wrapper
    .findComponent(MediaFilePicker)
    .vm.$emit("update:modelValue", file);
  return file;
}

function lastActiveState(wrapper: VueWrapper): boolean | undefined {
  const events = wrapper.emitted("active-change");
  if (!events || events.length === 0) return undefined;
  return events[events.length - 1][0] as boolean;
}

async function chooseMode(wrapper: VueWrapper, value: "transcribe" | "translate") {
  const radio = wrapper.find(`input[value="${value}"]`);
  (radio.element as HTMLInputElement).checked = true;
  await radio.trigger("change");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchTaskList).mockReset();
  vi.mocked(submitSubtitle).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SubtitleTasks", () => {
  it("submits the picked file with the default transcribe mode", async () => {
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    const file = new File([new Uint8Array(2048)], "clip.wav");
    vi.mocked(submitSubtitle).mockResolvedValue(makeTask());
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await wrapper
      .findComponent(MediaFilePicker)
      .vm.$emit("update:modelValue", file);
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(0);

    expect(submitSubtitle).toHaveBeenCalledWith(file, "transcribe");
    wrapper.unmount();
  });

  it("submits with translate when that radio button is selected", async () => {
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    vi.mocked(submitSubtitle).mockResolvedValue(makeTask({ mode: "translate" }));
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    const file = await pickFile(wrapper);
    await chooseMode(wrapper, "translate");
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(0);

    expect(submitSubtitle).toHaveBeenCalledWith(file, "translate");
    wrapper.unmount();
  });

  it("uploads only once when submit is triggered twice and locks the form", async () => {
    const pending = deferred<SubtitleTask>();
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    vi.mocked(submitSubtitle).mockReturnValue(pending.promise);
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await pickFile(wrapper);
    await wrapper.find("form").trigger("submit");
    await wrapper.find("form").trigger("submit");

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    expect(buttonByText(wrapper, "正在上传…").exists()).toBe(true);
    expect(
      wrapper.findComponent(MediaFilePicker).find("button").attributes("disabled"),
    ).toBeDefined();

    pending.resolve(makeTask());
    await vi.advanceTimersByTimeAsync(0);
    expect(buttonByText(wrapper, "生成字幕").exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps the mode, clears the file and shows the accepted task id", async () => {
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    vi.mocked(submitSubtitle).mockResolvedValue(
      makeTask({
        id: "b".repeat(32),
        mode: "translate",
        status: "queued",
        stage: "queued",
        original_name: "clip.wav",
        result: null,
      }),
    );
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await pickFile(wrapper);
    await chooseMode(wrapper, "translate");
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain(`已受理，任务编号：${"b".repeat(32)}`);
    expect(wrapper.findComponent(MediaFilePicker).text()).toContain("选择文件");
    expect(
      (wrapper.find('input[value="translate"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(wrapper.text()).toContain("clip.wav");
    wrapper.unmount();
  });

  it("still shows the accepted task when the list refresh fails", async () => {
    vi.mocked(fetchTaskList).mockRejectedValue(new Error("网络连接失败"));
    vi.mocked(submitSubtitle).mockResolvedValue(
      makeTask({
        id: "c".repeat(32),
        original_name: "accepted.wav",
        status: "queued",
        stage: "queued",
        result: null,
      }),
    );
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await pickFile(wrapper);
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("accepted.wav");
    expect(wrapper.text()).toContain("任务列表刷新失败（网络连接失败）");
    expect(lastActiveState(wrapper)).toBe(true);
    wrapper.unmount();
  });

  it("keeps the file and mode after a queue-full rejection without retrying", async () => {
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    vi.mocked(submitSubtitle).mockRejectedValue(
      new Error("等待队列已满，请稍后重试。"),
    );
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await pickFile(wrapper, "queued.wav");
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(30000);

    expect(wrapper.find('[role="alert"]').text()).toBe(
      "等待队列已满，请稍后重试。",
    );
    expect(wrapper.findComponent(MediaFilePicker).text()).toContain("queued.wav");
    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("never runs two list requests at the same time", async () => {
    const pending = deferred<TaskListResponse>();
    vi.mocked(fetchTaskList).mockReturnValue(pending.promise);
    const wrapper = mount(SubtitleTasks);

    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchTaskList).toHaveBeenCalledTimes(1);

    pending.resolve(makeList([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTaskList).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("collapses the post-submit refresh into the request already in flight", async () => {
    const pending = deferred<TaskListResponse>();
    vi.mocked(fetchTaskList).mockReturnValue(pending.promise);
    vi.mocked(submitSubtitle).mockResolvedValue(makeTask());
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTaskList).toHaveBeenCalledTimes(1);

    await pickFile(wrapper);
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(10000);

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    // 轮询尚未返回，提交后安排的刷新必须被合并掉。
    expect(fetchTaskList).toHaveBeenCalledTimes(1);

    pending.resolve(makeList([]));
    await vi.advanceTimersByTimeAsync(0);
    wrapper.unmount();
  });

  it("polls every two seconds while a task is active and every five when idle", async () => {
    vi.mocked(fetchTaskList).mockResolvedValueOnce(
      makeList([makeTask({ status: "running", stage: "processing" })]),
    );
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTaskList).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchTaskList).toHaveBeenCalledTimes(2);

    // 第二页响应已无活动任务，节奏退回 5 秒。
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchTaskList).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTaskList).toHaveBeenCalledTimes(3);

    wrapper.unmount();
  });

  it("stops requesting after unmount", async () => {
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchTaskList).toHaveBeenCalledTimes(1);
  });

  it("keeps reporting active tasks from page one while browsing page two", async () => {
    const pageOne = makeList(
      [
        makeTask({
          id: "d".repeat(32),
          status: "running",
          stage: "processing",
          original_name: "active.wav",
        }),
      ],
      25,
      0,
    );
    const pageTwo = makeList(
      [
        makeTask({
          id: "e".repeat(32),
          original_name: "historic.wav",
          result: { model: "m", text: "历史", duration: 1, processing_time: 1 },
        }),
      ],
      25,
      20,
    );
    vi.mocked(fetchTaskList).mockImplementation(
      async (limit = 20, offset = 0) => (offset === 0 ? pageOne : pageTwo),
    );
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await buttonByText(wrapper, "下一页").trigger("click");
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("第 2 页／共 2 页");
    expect(wrapper.text()).toContain("historic.wav");
    expect(wrapper.text()).not.toContain("active.wav");
    expect(lastActiveState(wrapper)).toBe(true);
    expect(fetchTaskList).toHaveBeenLastCalledWith(20, 20);

    wrapper.unmount();
  });

  it("returns to the last valid page when the viewed page becomes empty", async () => {
    const kept = makeTask({ original_name: "kept.wav" });
    vi.mocked(fetchTaskList)
      .mockResolvedValueOnce(makeList([kept], 25, 0))
      .mockImplementation(async (limit = 20, offset = 0) =>
        offset === 0 ? makeList([kept], 1, 0) : makeList([], 1, offset),
      );
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    await buttonByText(wrapper, "下一页").trigger("click");
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("第 1 页／共 1 页");
    expect(wrapper.text()).toContain("kept.wav");
    expect(fetchTaskList).toHaveBeenLastCalledWith(20, 0);

    wrapper.unmount();
  });

  it("keeps rendered tasks when a later refresh fails", async () => {
    vi.mocked(fetchTaskList).mockResolvedValueOnce(
      makeList([makeTask({ original_name: "stable.wav" })]),
    );
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.text()).toContain("stable.wav");

    vi.mocked(fetchTaskList).mockRejectedValue(new Error("boom"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(wrapper.text()).toContain("stable.wav");
    expect(wrapper.text()).toContain("已有记录已保留");
    // 活动状态沿用上一次成功结果，失败刷新不再重复广播。
    expect(wrapper.emitted("active-change")).toHaveLength(1);
    expect(lastActiveState(wrapper)).toBe(false);
    wrapper.unmount();
  });

  it("disables pagination and manual refresh while a request is running", async () => {
    const pending = deferred<TaskListResponse>();
    vi.mocked(fetchTaskList).mockReturnValue(pending.promise);
    const wrapper = mount(SubtitleTasks);
    await vi.advanceTimersByTimeAsync(0);

    expect(buttonByText(wrapper, "刷新中…").attributes("disabled")).toBeDefined();
    pending.resolve(makeList([makeTask()], 25, 0));
    await vi.advanceTimersByTimeAsync(0);

    expect(buttonByText(wrapper, "刷新").attributes("disabled")).toBeUndefined();
    expect(buttonByText(wrapper, "下一页").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("shows an empty state instead of a spinner once the first load settles", async () => {
    vi.mocked(fetchTaskList).mockResolvedValue(makeList([]));
    const wrapper = mount(SubtitleTasks);
    expect(wrapper.text()).toContain("正在加载任务…");

    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.text()).toContain("暂无任务，请先提交音视频。");
    expect(wrapper.text()).not.toContain("正在加载任务…");
    wrapper.unmount();
  });
});
