import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTaskList, submitSubtitle } from "../api";
import type { SubtitleTask, TaskListResponse } from "../api";
import SubtitleTasks from "./SubtitleTasks.vue";

vi.mock("../api", () => ({
  fetchTaskList: vi.fn(),
  submitSubtitle: vi.fn(),
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
}));

const mockFetchTaskList = vi.mocked(fetchTaskList);
const mockSubmitSubtitle = vi.mocked(submitSubtitle);

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "queued",
    stage: "queued",
    original_name: "sample.flac",
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

function listResponse(
  tasks: SubtitleTask[],
  total = tasks.length,
): TaskListResponse {
  return { tasks, total, limit: 20, offset: 0 };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function audioFile(name = "sample.flac", size = 3): File {
  return new File([new Uint8Array(size)], name);
}

async function selectFile(wrapper: ReturnType<typeof mount>, file: File) {
  const input = wrapper.find('.file-picker input[type="file"]')
    .element as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await wrapper.find('.file-picker input[type="file"]').trigger("change");
}

function submitButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('button[type="submit"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFetchTaskList.mockReset();
  mockSubmitSubtitle.mockReset();
  mockFetchTaskList.mockResolvedValue(listResponse([]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SubtitleTasks 提交", () => {
  it("没有选择文件时提交按钮不可用", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("默认以日语转录模式提交，受理后清空文件并展示任务编号", async () => {
    const accepted = makeTask({ id: "a".repeat(32) });
    mockSubmitSubtitle.mockResolvedValue(accepted);
    mockFetchTaskList.mockResolvedValue(listResponse([accepted], 1));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    const file = audioFile();
    await selectFile(wrapper, file);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockSubmitSubtitle).toHaveBeenCalledTimes(1);
    expect(mockSubmitSubtitle.mock.calls[0][0]).toBe(file);
    expect(mockSubmitSubtitle.mock.calls[0][1]).toBe("transcribe");

    expect(wrapper.find('[role="status"]').text()).toContain(accepted.id);
    // 已提交文件被清空，处理方式保留
    expect(wrapper.find(".file-picker .file-name").exists()).toBe(false);
    const transcribe = wrapper.findAll('input[type="radio"]')[0]
      .element as HTMLInputElement;
    expect(transcribe.checked).toBe(true);
    // 列表里能看到刚受理的任务
    expect(wrapper.text()).toContain("sample.flac");
    const submitEvents = wrapper.emitted("active-change")!;
    expect(submitEvents[submitEvents.length - 1]).toEqual([true]);
    wrapper.unmount();
  });

  it("选择翻译模式后按翻译模式提交", async () => {
    const accepted = makeTask({ id: "b".repeat(32), mode: "translate" });
    mockSubmitSubtitle.mockResolvedValue(accepted);

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await wrapper.findAll('input[type="radio"]')[1].setValue(true);
    await selectFile(wrapper, audioFile("movie.mkv"));
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockSubmitSubtitle.mock.calls[0][1]).toBe("translate");
    wrapper.unmount();
  });

  it("上传期间锁定表单，连续点击只产生一次上传", async () => {
    const pending = deferred<SubtitleTask>();
    mockSubmitSubtitle.mockReturnValue(pending.promise);

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await selectFile(wrapper, audioFile());
    await wrapper.find("form").trigger("submit");
    await wrapper.find("form").trigger("submit");

    expect(mockSubmitSubtitle).toHaveBeenCalledTimes(1);
    expect(submitButton(wrapper).text()).toBe("正在上传…");
    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();

    pending.resolve(makeTask({ id: "c".repeat(32) }));
    await flushPromises();
    expect(submitButton(wrapper).text()).toBe("生成字幕");
    wrapper.unmount();
  });

  it("受理成功但列表刷新失败时仍能看到任务与编号", async () => {
    const accepted = makeTask({ id: "d".repeat(32), original_name: "drama.mp4" });
    mockSubmitSubtitle.mockResolvedValue(accepted);

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    mockFetchTaskList.mockRejectedValueOnce(new Error("网络中断"));

    await selectFile(wrapper, audioFile("drama.mp4"));
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toContain(accepted.id);
    expect(wrapper.text()).toContain("drama.mp4");
    const alert = wrapper.find('[role="alert"]');
    expect(alert.text()).toContain("任务列表刷新失败");
    expect(alert.text()).toContain("网络中断");
    wrapper.unmount();
  });

  it("提交失败保留文件和模式，队列已满不自动重试", async () => {
    mockSubmitSubtitle.mockRejectedValue(new Error("队列已满，请稍后再试。"));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await wrapper.findAll('input[type="radio"]')[1].setValue(true);
    await selectFile(wrapper, audioFile("keep.m4a"));
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("队列已满");
    expect(wrapper.find(".file-picker .file-name").text()).toBe("keep.m4a");
    const translate = wrapper.findAll('input[type="radio"]')[1]
      .element as HTMLInputElement;
    expect(translate.checked).toBe(true);

    await vi.advanceTimersByTimeAsync(30000);
    expect(mockSubmitSubtitle).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("SubtitleTasks 轮询", () => {
  it("请求不重叠：前一个请求未结束时不会发起下一个", async () => {
    const pending: Array<Deferred<TaskListResponse>> = [];
    mockFetchTaskList.mockImplementation(() => {
      const d = deferred<TaskListResponse>();
      pending.push(d);
      return d.promise;
    });

    const wrapper = mount(SubtitleTasks);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);

    pending[0].resolve(listResponse([]));
    await flushPromises();

    await vi.advanceTimersByTimeAsync(4999);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(2);

    pending[1].resolve(listResponse([]));
    await flushPromises();
    wrapper.unmount();
  });

  it("存在活动任务时两秒后轮询，空闲时五秒", async () => {
    const active = makeTask({ status: "running", stage: "processing" });
    mockFetchTaskList.mockResolvedValue(listResponse([active], 1));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("卸载后不再发起请求", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(mockFetchTaskList).toHaveBeenCalledTimes(1);
  });

  it("刷新失败保留已有任务和活动状态", async () => {
    const active = makeTask({ status: "running", stage: "processing" });
    mockFetchTaskList.mockResolvedValueOnce(listResponse([active], 1));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(wrapper.text()).toContain("sample.flac");
    const initialEvents = wrapper.emitted("active-change")!;
    expect(initialEvents[initialEvents.length - 1]).toEqual([true]);

    mockFetchTaskList.mockRejectedValueOnce(new Error("连接超时"));
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(wrapper.text()).toContain("sample.flac");
    expect(wrapper.find('[role="alert"]').text()).toContain("任务列表刷新失败");
    for (const event of wrapper.emitted("active-change")!) {
      expect(event).toEqual([true]);
    }
    wrapper.unmount();
  });
});

describe("SubtitleTasks 分页", () => {
  function pagedMock(firstPageTasks: SubtitleTask[], rest: SubtitleTask[], total: number) {
    mockFetchTaskList.mockImplementation((_limit?: number, offset = 0) =>
      Promise.resolve(
        offset === 0 ? listResponse(firstPageTasks, total) : listResponse(rest, total),
      ),
    );
  }

  it("查看历史页时活动状态仍以第一页为准", async () => {
    const active = makeTask({ status: "running", stage: "processing", original_name: "active-task.flac" });
    const history = Array.from({ length: 5 }, (_, i) =>
      makeTask({
        id: String(i).padStart(32, "0"),
        status: "succeeded",
        stage: "completed",
        original_name: `old-${i}.flac`,
      }),
    );
    pagedMock([active], history, 25);

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    const mountEvents = wrapper.emitted("active-change")!;
    expect(mountEvents[mountEvents.length - 1]).toEqual([true]);

    const next = wrapper
      .findAll(".pagination button")
      .find((b) => b.text() === "下一页")!;
    await next.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("old-0.flac");
    expect(wrapper.text()).not.toContain("active-task.flac");
    expect(wrapper.find(".page-indicator").text()).toContain("第 2 页");
    const pageEvents = wrapper.emitted("active-change")!;
    expect(pageEvents[pageEvents.length - 1]).toEqual([true]);
    wrapper.unmount();
  });

  it("当前页因任务过期变空时回退到最后有效页", async () => {
    const pageOne = Array.from({ length: 20 }, (_, i) =>
      makeTask({ id: `f${String(i).padStart(31, "0")}`, original_name: `p1-${i}.flac` }),
    );
    let firstCallTotal = 40;
    mockFetchTaskList.mockImplementation((_limit?: number, offset = 0) => {
      if (offset === 0) {
        const total = firstCallTotal;
        firstCallTotal = 20;
        return Promise.resolve(listResponse(pageOne, total));
      }
      return Promise.resolve(listResponse([], 20));
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(wrapper.find(".page-indicator").text()).toContain("第 1 页 / 共 2 页");

    const next = wrapper
      .findAll(".pagination button")
      .find((b) => b.text() === "下一页")!;
    await next.trigger("click");
    await flushPromises();

    // 回退到第 1 页（挂载 1 次 + 翻页时第一页/第二页/回退重取共 3 次）
    expect(mockFetchTaskList).toHaveBeenCalledTimes(4);
    expect(wrapper.text()).toContain("p1-0.flac");
    // 只剩一页后分页导航隐藏
    expect(wrapper.find(".pagination").exists()).toBe(false);
    wrapper.unmount();
  });

  it("刷新期间禁用分页与手动刷新", async () => {
    const pageOne = Array.from({ length: 20 }, (_, i) =>
      makeTask({ id: `e${String(i).padStart(31, "0")}` }),
    );
    const pending: Array<Deferred<TaskListResponse>> = [];
    mockFetchTaskList.mockImplementation(() => {
      const d = deferred<TaskListResponse>();
      pending.push(d);
      return d.promise;
    });

    const wrapper = mount(SubtitleTasks);
    pending[0].resolve(listResponse(pageOne, 40));
    await flushPromises();

    const refresh = wrapper
      .findAll("button")
      .find((b) => b.text() === "刷新")!;
    await refresh.trigger("click");
    expect(mockFetchTaskList).toHaveBeenCalledTimes(2);

    const paginationButtons = wrapper.findAll(".pagination button");
    for (const button of paginationButtons) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    expect(
      wrapper.findAll("button").find((b) => b.text() === "正在刷新…"),
    ).toBeTruthy();

    pending[1].resolve(listResponse(pageOne, 40));
    await flushPromises();
    wrapper.unmount();
  });
});
