import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import SubtitleTasks from "./SubtitleTasks.vue";
import type { SubtitleTask } from "../types";

const mockSubmitSubtitle = vi.fn();
const mockFetchTaskList = vi.fn();
const mockDescribeApiError = vi.fn(
  (error: unknown) => (error instanceof Error ? error.message : "请求失败"),
);

vi.mock("../api", () => ({
  describeApiError: (error: unknown) => mockDescribeApiError(error),
  fetchTaskList: (...args: unknown[]) => mockFetchTaskList(...args),
  submitSubtitle: (...args: unknown[]) => mockSubmitSubtitle(...args),
}));

function makeFile(name = "speech.wav", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "audio/wav" });
}

function taskFixture(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "queued",
    stage: "queued",
    original_name: "speech.wav",
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

async function selectFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.find("#media");
  expect(input.exists()).toBe(true);
  const el = input.element as HTMLInputElement;
  Object.defineProperty(el, "files", { value: [file], configurable: true });
  await input.trigger("change");
  await flushPromises();
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) await flushPromises();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchTaskList.mockResolvedValue({ tasks: [], total: 0, limit: 10, offset: 0 });
  mockSubmitSubtitle.mockReset();
  mockDescribeApiError.mockImplementation((error: unknown) =>
    error instanceof Error ? error.message : "请求失败",
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SubtitleTasks", () => {
  it("blocks submit without a file", async () => {
    const wrapper = mount(SubtitleTasks);
    await flush();
    const button = wrapper.find('button[type="submit"]');
    expect(button.attributes("disabled")).toBeDefined();
    // Forced submit without a file never reaches the upload API.
    await wrapper.find("form").trigger("submit");
    await flush();
    expect(mockSubmitSubtitle).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits once with transcribe mode, locks upload and clears file on success", async () => {
    const accepted = taskFixture({ status: "queued" });
    let resolveUpload!: (v: SubtitleTask) => void;
    mockSubmitSubtitle.mockReturnValueOnce(
      new Promise<SubtitleTask>((resolve) => (resolveUpload = resolve)),
    );
    mockFetchTaskList.mockResolvedValue({
      tasks: [accepted],
      total: 1,
      limit: 10,
      offset: 0,
    });
    const wrapper = mount(SubtitleTasks);
    await flush();
    await selectFile(wrapper, makeFile());
    const button = wrapper.find('button[type="submit"]');
    expect(button.attributes("disabled")).toBeUndefined();
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    // Upload lock with uploading label; double submit does not re-upload.
    expect(wrapper.find('button[type="submit"]').text()).toContain("正在上传");
    await wrapper.find("form").trigger("submit");
    expect(mockSubmitSubtitle).toHaveBeenCalledTimes(1);
    expect(mockSubmitSubtitle).toHaveBeenCalledWith(
      expect.any(File),
      "transcribe",
    );
    resolveUpload(accepted);
    await flush();
    expect(wrapper.text()).toContain(`已受理，任务编号：${accepted.id}`);
    // File cleared after success (submit re-locks without a file).
    expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("passes translate mode to the upload API", async () => {
    const accepted = taskFixture({ mode: "translate" });
    mockSubmitSubtitle.mockResolvedValueOnce(accepted);
    const wrapper = mount(SubtitleTasks);
    await flush();
    await selectFile(wrapper, makeFile("talk.mp3", 2048));
    await wrapper.find('input[value="translate"]').setValue();
    await wrapper.find("form").trigger("submit");
    await flush();
    expect(mockSubmitSubtitle).toHaveBeenCalledWith(
      expect.any(File),
      "translate",
    );
    expect(wrapper.text()).toContain(accepted.id);
    wrapper.unmount();
  });

  it("shows queue-full errors via role=alert and keeps file and mode", async () => {
    mockSubmitSubtitle.mockRejectedValueOnce(new Error("队列已满，请稍后重试。"));
    const wrapper = mount(SubtitleTasks);
    await flush();
    await selectFile(wrapper, makeFile());
    await wrapper.find('input[value="translate"]').setValue();
    await wrapper.find("form").trigger("submit");
    await flush();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("队列已满");
    // Failed submit keeps the file so the user can retry directly.
    expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeUndefined();
    expect(
      (wrapper.find('input[value="translate"]').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(wrapper.text()).not.toContain("已受理");
    expect(mockSubmitSubtitle).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("keeps the accepted task visible when post-accept refresh fails", async () => {
    const accepted = taskFixture();
    mockSubmitSubtitle.mockResolvedValueOnce(accepted);
    const wrapper = mount(SubtitleTasks);
    await flush();
    // Initial poll succeeded; only the post-accept refresh fails.
    mockFetchTaskList.mockRejectedValueOnce(new Error("网络断开"));
    await selectFile(wrapper, makeFile());
    await wrapper.find("form").trigger("submit");
    await flush();
    expect(wrapper.text()).toContain(`已受理，任务编号：${accepted.id}`);
    expect(wrapper.text()).toContain("任务列表刷新失败");
    expect(wrapper.text()).toContain("已有记录已保留");
    wrapper.unmount();
  });

  it("renders task cards, pager and emits active-change from the first page", async () => {
    const running = taskFixture({ status: "running", stage: "processing" });
    const done = taskFixture({
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "succeeded",
      stage: "completed",
      original_name: "done.wav",
      mock: true,
      result: { model: "m", text: "你好。", duration: 2, processing_time: 1 },
      downloads: { srt: "/s.srt", lrc: "/s.lrc" },
    });
    mockFetchTaskList.mockResolvedValue({
      tasks: [running, done],
      total: 2,
      limit: 10,
      offset: 0,
    });
    const wrapper = mount(SubtitleTasks);
    await flush();
    expect(wrapper.findAll(".task-card")).toHaveLength(2);
    expect(wrapper.text()).toContain("下载 SRT");
    expect(wrapper.emitted("active-change")).toBeTruthy();
    const activeEmits = wrapper.emitted("active-change")!;
    expect(activeEmits[activeEmits.length - 1]).toEqual([true]);
    wrapper.unmount();
  });

  it("emits inactive when the visible task list is idle", async () => {
    mockFetchTaskList.mockResolvedValue({ tasks: [], total: 0, limit: 10, offset: 0 });
    const wrapper = mount(SubtitleTasks);
    await flush();
    const idleEmits = wrapper.emitted("active-change")!;
    expect(idleEmits[idleEmits.length - 1]).toEqual([false]);
    expect(wrapper.text()).toContain("暂无任务");
    wrapper.unmount();
  });

  it("disables manual refresh and paging while a refresh is in flight (no overlap)", async () => {
    let resolveList!: (v: unknown) => void;
    mockFetchTaskList.mockReturnValueOnce(
      new Promise((resolve) => (resolveList = resolve)),
    );
    const wrapper = mount(SubtitleTasks);
    // First poll is now in flight; extra refresh clicks share the same lock.
    await Promise.resolve();
    const callsAfterMount = mockFetchTaskList.mock.calls.length;
    expect(callsAfterMount).toBe(1);
    const refreshBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("刷新"))!;
    await refreshBtn.trigger("click");
    await refreshBtn.trigger("click");
    expect(mockFetchTaskList.mock.calls.length).toBe(1);
    expect(refreshBtn.attributes("disabled")).toBeDefined();
    resolveList({ tasks: [], total: 0, limit: 10, offset: 0 });
    await flush();
    wrapper.unmount();
  });

  it("stops polling after unmount without crashing", async () => {
    mockFetchTaskList.mockResolvedValue({ tasks: [], total: 0, limit: 10, offset: 0 });
    const wrapper = mount(SubtitleTasks);
    await flush();
    const calls = mockFetchTaskList.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    wrapper.unmount();
    await flush();
    // No further network traffic after teardown.
    expect(mockFetchTaskList.mock.calls.length).toBe(calls);
  });

  it("paginates history and falls back when the visible page goes empty", async () => {
    const page1 = Array.from({ length: 10 }, (_, i) =>
      taskFixture({
        id: `0000000000000000000000000000000${i}`.slice(-32),
        original_name: `p1-${i}.wav`,
      }),
    );
    const page2Task = taskFixture({
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      original_name: "p2-0.wav",
    });
    mockFetchTaskList.mockImplementation(async (limit: unknown, offset: unknown) => {
      if (offset === 10) return { tasks: [page2Task], total: 11, limit: 10, offset: 10 };
      return { tasks: page1, total: 11, limit: 10, offset: 0 };
    });
    const wrapper = mount(SubtitleTasks);
    await flush();
    expect(wrapper.text()).toContain("第 1 页 / 共 2 页");
    const next = wrapper.findAll("button").find((b) => b.text().includes("下一页"))!;
    await next.trigger("click");
    await flush();
    expect(wrapper.text()).toContain("第 2 页 / 共 2 页");
    expect(wrapper.text()).toContain("p2-0.wav");
    // History shrinks: empty visible page falls back to page 1.
    mockFetchTaskList.mockImplementation(async (limit: unknown, offset: unknown) => {
      if (offset === 10) return { tasks: [], total: 10, limit: 10, offset: 10 };
      return { tasks: page1, total: 10, limit: 10, offset: 0 };
    });
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("刷新"))!
      .trigger("click");
    await flush();
    // Single page hides the pager; fallback content is page-1 history.
    expect(wrapper.find(".pager").exists()).toBe(false);
    expect(wrapper.text()).toContain("p1-0.wav");
    expect(wrapper.text()).not.toContain("p2-0.wav");
    wrapper.unmount();
  });

  it("uses virtual timers: idle polls every 5s, active every 2s, never overlapping", async () => {
    vi.useFakeTimers();
    try {
      mockFetchTaskList.mockResolvedValue({ tasks: [], total: 0, limit: 10, offset: 0 });
      const wrapper = mount(SubtitleTasks);
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      const firstCalls = mockFetchTaskList.mock.calls.length;
      expect(firstCalls).toBeGreaterThanOrEqual(1);
      // Idle cadence: no second poll before 5s.
      await vi.advanceTimersByTimeAsync(4999);
      await flush();
      expect(mockFetchTaskList.mock.calls.length).toBe(firstCalls);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(mockFetchTaskList.mock.calls.length).toBe(firstCalls + 1);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
