import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SubtitleTasks from "./SubtitleTasks.vue";
import {
  fetchTaskList,
  submitSubtitle,
  type SubtitleTask,
  type TaskListResponse,
} from "../api";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  fetchTaskList: vi.fn(),
  submitSubtitle: vi.fn(),
}));

const mockList = vi.mocked(fetchTaskList);
const mockSubmit = vi.mocked(submitSubtitle);

const idA = "a".repeat(32);
const idB = "b".repeat(32);

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: idA,
    mode: "transcribe",
    status: "queued",
    stage: "queued",
    original_name: "clip.wav",
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
  total: number,
  offset = 0,
): TaskListResponse {
  return { tasks, total, limit: 20, offset };
}

function findButton(
  wrapper: VueWrapper<InstanceType<typeof SubtitleTasks>>,
  label: string,
) {
  const button = wrapper.findAll("button").find((item) => item.text() === label);
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

function lastEmittedActive(wrapper: VueWrapper<InstanceType<typeof SubtitleTasks>>) {
  const emitted = wrapper.emitted("active-change");
  if (!emitted || emitted.length === 0) return undefined;
  return emitted[emitted.length - 1];
}

async function chooseFile(
  wrapper: VueWrapper<InstanceType<typeof SubtitleTasks>>,
  file: File,
) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [file] as unknown as FileList,
    configurable: true,
  });
  await input.trigger("change");
}

const fileA = new File(["audio-bytes"], "clip.wav");

// jsdom 不会因点击 submit 按钮派发表单的 submit 事件，直接对 form 触发。
async function submitForm(
  wrapper: VueWrapper<InstanceType<typeof SubtitleTasks>>,
) {
  await wrapper.find("form").trigger("submit");
}

beforeEach(() => {
  vi.resetAllMocks();
  mockList.mockResolvedValue(listResponse([], 0));
});

describe("SubtitleTasks 提交", () => {
  it("blocks submit without a file", async () => {
    const wrapper = mount(SubtitleTasks);
    await flushPromises();

    expect(findButton(wrapper, "生成字幕").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("submits with the chosen mode, clears the file and keeps the mode", async () => {
    const queued = makeTask({});
    mockSubmit.mockResolvedValue(queued);
    mockList.mockResolvedValue(listResponse([queued], 1));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, fileA);
    await wrapper.find('input[value="translate"]').setValue();
    await submitForm(wrapper);
    await flushPromises();
    await flushPromises();

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith(fileA, "translate");
    expect(wrapper.text()).toContain("选择文件");
    expect(
      (wrapper.find('input[value="translate"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(wrapper.text()).toContain("clip.wav");
    expect(wrapper.text()).not.toContain("已受理，任务编号");
    expect(mockList).toHaveBeenLastCalledWith(20, 0);
    wrapper.unmount();
  });

  it("locks the picker and modes and uploads only once on rapid clicks", async () => {
    let resolveSubmit: (task: SubtitleTask) => void = () => {};
    mockSubmit.mockImplementation(
      () =>
        new Promise<SubtitleTask>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, fileA);
    await submitForm(wrapper);

    expect(
      wrapper.find('input[value="transcribe"]').attributes("disabled"),
    ).toBeDefined();
    const removeButton = wrapper
      .findAll("button")
      .find((item) => item.text() === "移除文件");
    expect(removeButton?.attributes("disabled")).toBeDefined();

    await submitForm(wrapper);
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    resolveSubmit(makeTask({}));
    await flushPromises();
    await flushPromises();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("keeps file and mode and shows the queue-full error without retrying", async () => {
    mockSubmit.mockRejectedValue(new Error("队列已满，请稍后重试"));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, fileA);
    await wrapper.find('input[value="translate"]').setValue();
    await submitForm(wrapper);
    await flushPromises();
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("队列已满");
    expect(wrapper.text()).toContain("clip.wav");
    expect(
      (wrapper.find('input[value="translate"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("keeps the accepted task notice when the post-submit refresh fails", async () => {
    mockSubmit.mockResolvedValue(makeTask({}));
    mockList.mockRejectedValue(new Error("网络错误"));

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await chooseFile(wrapper, fileA);
    await submitForm(wrapper);
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("已受理，任务编号");
    expect(wrapper.find('[role="alert"]').text()).toContain("任务列表刷新失败");
    wrapper.unmount();
  });
});

describe("SubtitleTasks 展示与轮询", () => {
  it("emits active-change from the first page and keeps it while paginating", async () => {
    const running = makeTask({ id: idB, status: "running", stage: "processing" });
    mockList.mockImplementation((_limit, offset) =>
      Promise.resolve(
        offset === 0
          ? listResponse([running, makeTask({ status: "succeeded", stage: "completed" })], 45)
          : listResponse([makeTask({ status: "succeeded", stage: "completed" })], 45),
      ),
    );

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(lastEmittedActive(wrapper)).toEqual([true]);

    await findButton(wrapper, "下一页").trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("第 2 页");
    expect(mockList).toHaveBeenCalledWith(20, 20);
    expect(lastEmittedActive(wrapper)).toEqual([true]);
    wrapper.unmount();
  });

  it("polls serially without overlap and adapts the interval", async () => {
    vi.useFakeTimers();
    try {
      let resolvePage: (value: TaskListResponse) => void = () => {};
      mockList.mockImplementation(
        () =>
          new Promise<TaskListResponse>((resolve) => {
            resolvePage = resolve;
          }),
      );

      const wrapper = mount(SubtitleTasks);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockList).toHaveBeenCalledTimes(1);
      expect(findButton(wrapper, "刷新").attributes("disabled")).toBeDefined();

      // 请求未返回期间不再发出新的轮询请求。
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockList).toHaveBeenCalledTimes(1);

      resolvePage(
        listResponse([makeTask({ status: "running", stage: "processing" })], 1),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mockList).toHaveBeenCalledTimes(1);

      // 有活动任务时 2 秒后再次轮询。
      await vi.advanceTimersByTimeAsync(1999);
      expect(mockList).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockList).toHaveBeenCalledTimes(2);

      // 无活动任务时间隔变为 5 秒。
      resolvePage(listResponse([], 0));
      await vi.advanceTimersByTimeAsync(4999);
      expect(mockList).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockList).toHaveBeenCalledTimes(3);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling and updating after unmount", async () => {
    vi.useFakeTimers();
    try {
      mockList.mockResolvedValue(listResponse([], 0));
      const wrapper = mount(SubtitleTasks);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10000);

      const calls = mockList.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(2);

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockList.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns to the last valid page when the current page expires", async () => {
    let expired = false;
    mockList.mockImplementation((_limit, offset) => {
      if (!expired) {
        return Promise.resolve(
          offset === 0
            ? listResponse([makeTask({ id: idA, status: "succeeded", stage: "completed" })], 45)
            : listResponse([makeTask({ id: idB, status: "succeeded", stage: "completed" })], 45),
        );
      }
      return Promise.resolve(
        offset === 0
          ? listResponse([makeTask({ id: idA, status: "succeeded", stage: "completed" })], 10)
          : listResponse([], 10),
      );
    });

    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    await findButton(wrapper, "下一页").trigger("click");
    await flushPromises();
    await flushPromises();
    expect(wrapper.text()).toContain("第 2 页");

    expired = true;
    await findButton(wrapper, "刷新").trigger("click");
    await flushPromises();
    await flushPromises();

    expect(mockList).toHaveBeenLastCalledWith(20, 0);
    expect(wrapper.text()).toContain("第 1 页");
    expect(findButton(wrapper, "上一页").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("keeps previous tasks and active state when a refresh fails", async () => {
    const running = makeTask({ status: "running", stage: "processing" });
    mockList.mockResolvedValueOnce(listResponse([running], 1));
    const wrapper = mount(SubtitleTasks);
    await flushPromises();
    expect(wrapper.text()).toContain("clip.wav");

    mockList.mockRejectedValue(new Error("网络错误"));
    await findButton(wrapper, "刷新").trigger("click");
    await flushPromises();
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("网络错误");
    expect(wrapper.text()).toContain("clip.wav");
    expect(lastEmittedActive(wrapper)).toEqual([true]);
    wrapper.unmount();
  });
});
