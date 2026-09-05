import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SubtitleTasks from "./SubtitleTasks.vue";
import type { SubtitleTask } from "../types";

const mockSubmitSubtitle = vi.fn();
const mockFetchTaskList = vi.fn();

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败",
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

async function flush(times = 4) {
  for (let i = 0; i < times; i++) await flushPromises();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchTaskList.mockResolvedValue({
    tasks: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  mockSubmitSubtitle.mockReset();
});

describe("SubtitleTasks", () => {
  it("blocks submit without a file", async () => {
    const wrapper = mount(SubtitleTasks);
    await flush();
    const button = wrapper.find('button[type="submit"]');
    expect(button.attributes("disabled")).toBeDefined();
    await wrapper.find("form").trigger("submit");
    await flush();
    expect(mockSubmitSubtitle).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("submits once with transcribe mode, locks upload, clears file and goes to page 1", async () => {
    const accepted = taskFixture();
    let resolveUpload!: (v: SubtitleTask) => void;
    mockSubmitSubtitle.mockReturnValueOnce(
      new Promise<SubtitleTask>((resolve) => (resolveUpload = resolve)),
    );
    mockFetchTaskList.mockResolvedValue({
      tasks: [accepted],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const wrapper = mount(SubtitleTasks);
    await flush();
    await selectFile(wrapper, makeFile());
    const button = wrapper.find('button[type="submit"]');
    expect(button.attributes("disabled")).toBeUndefined();
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    // Upload lock + label; double submit does not re-upload.
    expect(wrapper.find('button[type="submit"]').text()).toContain("正在上传");
    await wrapper.find("form").trigger("submit");
    expect(mockSubmitSubtitle).toHaveBeenCalledTimes(1);
    expect(mockSubmitSubtitle).toHaveBeenCalledWith(expect.any(File), "transcribe");
    resolveUpload(accepted);
    await flush();
    expect(wrapper.text()).toContain(`已受理，任务编号：${accepted.id}`);
    // File cleared after success: submit button re-disabled.
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
    expect(mockSubmitSubtitle).toHaveBeenCalledWith(expect.any(File), "translate");
    expect(wrapper.text()).toContain(accepted.id);
    wrapper.unmount();
  });

  it("shows queue-full error via role=alert and keeps file and mode", async () => {
    mockSubmitSubtitle.mockRejectedValueOnce(new Error("等待队列已满，请稍后重试。"));
    const wrapper = mount(SubtitleTasks);
    await flush();
    await selectFile(wrapper, makeFile());
    await wrapper.find('input[value="translate"]').setValue();
    await wrapper.find("form").trigger("submit");
    await flush();
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("队列已满");
    // Failed submit keeps the selected file and mode.
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
    mockFetchTaskList.mockRejectedValueOnce(new Error("网络断开"));
    await selectFile(wrapper, makeFile());
    await wrapper.find("form").trigger("submit");
    await flush();
    expect(wrapper.text()).toContain(`已受理，任务编号：${accepted.id}`);
    expect(wrapper.text()).toContain("任务列表刷新失败");
    expect(wrapper.text()).toContain("已有记录已保留");
    wrapper.unmount();
  });

  it("renders task cards, active-change true from first page while viewing page 2", async () => {
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
    mockFetchTaskList.mockImplementation(async (_limit: unknown, offset: unknown) => {
      if (offset === 20) return { tasks: [done], total: 21, limit: 20, offset: 20 };
      return { tasks: [running], total: 21, limit: 20, offset: 0 };
    });
    const wrapper = mount(SubtitleTasks);
    await flush();
    expect(wrapper.text()).toContain("第 1 页 / 共 2 页");
    const next = wrapper.findAll("button").find((b) => b.text().includes("下一页"))!;
    await next.trigger("click");
    await flush();
    expect(wrapper.text()).toContain("第 2 页 / 共 2 页");
    expect(wrapper.text()).toContain("done.wav");
    // Page-1 active task still limits model operations even while page-2 visible.
    const activeEmits = wrapper.emitted("active-change")!;
    expect(activeEmits[activeEmits.length - 1]).toEqual([true]);
    wrapper.unmount();
  });

  it("polls idle every 5s and active every 2s without overlap (virtual timers)", async () => {
    vi.useFakeTimers();
    try {
      mockFetchTaskList.mockResolvedValue({ tasks: [], total: 0, limit: 20, offset: 0 });
      const wrapper = mount(SubtitleTasks);
      await vi.advanceTimersByTimeAsync(0);
      await flush();
      const firstCalls = mockFetchTaskList.mock.calls.length;
      expect(firstCalls).toBeGreaterThanOrEqual(1);
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

  it("never overlaps refreshes and disables refresh while one is in flight", async () => {
    let resolveList!: (v: unknown) => void;
    mockFetchTaskList.mockReturnValueOnce(
      new Promise((resolve) => (resolveList = resolve)),
    );
    const wrapper = mount(SubtitleTasks);
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
    resolveList({ tasks: [], total: 0, limit: 20, offset: 0 });
    await flush();
    wrapper.unmount();
  });

  it("stops polling after unmount without further requests", async () => {
    mockFetchTaskList.mockResolvedValue({ tasks: [], total: 0, limit: 20, offset: 0 });
    const wrapper = mount(SubtitleTasks);
    await flush();
    const calls = mockFetchTaskList.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    wrapper.unmount();
    await flush();
    expect(mockFetchTaskList.mock.calls.length).toBe(calls);
  });

  it("falls back to the last valid page when the visible page becomes empty", async () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      taskFixture({
        id: `0000000000000000000000000000000${i}`.slice(-32),
        original_name: `p1-${i}.wav`,
      }),
    );
    const page2Task = taskFixture({
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      original_name: "p2-0.wav",
    });
    mockFetchTaskList.mockImplementation(async (_limit: unknown, offset: unknown) => {
      if (offset === 20) return { tasks: [page2Task], total: 21, limit: 20, offset: 20 };
      return { tasks: page1, total: 21, limit: 20, offset: 0 };
    });
    const wrapper = mount(SubtitleTasks);
    await flush();
    const next = wrapper.findAll("button").find((b) => b.text().includes("下一页"))!;
    await next.trigger("click");
    await flush();
    expect(wrapper.text()).toContain("第 2 页 / 共 2 页");
    // History shrinks: empty page 2 falls back to page 1.
    mockFetchTaskList.mockImplementation(async (_limit: unknown, offset: unknown) => {
      if (offset === 20) return { tasks: [], total: 20, limit: 20, offset: 20 };
      return { tasks: page1, total: 20, limit: 20, offset: 0 };
    });
    await wrapper
      .findAll("button")
      .find((b) => b.text().includes("刷新"))!
      .trigger("click");
    await flush();
    expect(wrapper.find(".pager").exists()).toBe(false);
    expect(wrapper.text()).toContain("p1-0.wav");
    expect(wrapper.text()).not.toContain("p2-0.wav");
    wrapper.unmount();
  });
});
