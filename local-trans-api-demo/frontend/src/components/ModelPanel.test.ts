import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
} from "../api";
import type { DownloadProgress, ModelInfo } from "../api";
import ModelPanel from "./ModelPanel.vue";

vi.mock("../api", () => ({
  fetchDownloadProgress: vi.fn(),
  fetchModels: vi.fn(),
  loadModel: vi.fn(),
  startModelDownload: vi.fn(),
  unloadModel: vi.fn(),
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
}));

const mockFetchModels = vi.mocked(fetchModels);
const mockFetchProgress = vi.mocked(fetchDownloadProgress);
const mockLoadModel = vi.mocked(loadModel);
const mockUnloadModel = vi.mocked(unloadModel);
const mockStartDownload = vi.mocked(startModelDownload);

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

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "model-1",
    name: "模型一",
    type: "whisper",
    installed: true,
    loaded: false,
    mock: false,
    ...overrides,
  };
}

function idleProgress(): DownloadProgress {
  return { state: "idle" };
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((b) => b.text() === text);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFetchModels.mockReset();
  mockFetchProgress.mockReset();
  mockLoadModel.mockReset();
  mockUnloadModel.mockReset();
  mockStartDownload.mockReset();
  mockFetchModels.mockResolvedValue([]);
  mockFetchProgress.mockResolvedValue(idleProgress());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ModelPanel 列表", () => {
  it("请求期间显示加载提示，空列表显示暂无可用模型", async () => {
    const pending = deferred<ModelInfo[]>();
    mockFetchModels.mockReturnValue(pending.promise);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    expect(wrapper.text()).toContain("正在加载模型列表…");

    pending.resolve([]);
    await flushPromises();
    expect(wrapper.text()).toContain("暂无可用模型。");
    wrapper.unmount();
  });

  it("展示模型状态徽标", async () => {
    mockFetchModels.mockResolvedValue([
      model({ id: "m1", name: "模型一", loaded: true }),
      model({ id: "m2", name: "模型二", installed: true }),
      model({ id: "m3", name: "模型三", installed: false }),
    ]);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    expect(wrapper.text()).toContain("已加载");
    expect(wrapper.text()).toContain("已安装");
    expect(wrapper.text()).toContain("未安装");
    wrapper.unmount();
  });

  it("列表请求失败时提示错误并保留已有模型", async () => {
    mockFetchModels.mockResolvedValueOnce([model({ id: "m1", name: "模型一" })]);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();
    expect(wrapper.text()).toContain("模型一");

    mockFetchModels.mockRejectedValueOnce(new Error("服务不可用"));
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("服务不可用");
    expect(wrapper.text()).toContain("模型一");
    wrapper.unmount();
  });
});

describe("ModelPanel 操作", () => {
  it("加载按钮显示精确的加载中状态", async () => {
    mockFetchModels.mockResolvedValue([
      model({ id: "m1", name: "模型一" }),
      model({ id: "m2", name: "模型二" }),
    ]);
    const pending = deferred<void>();
    mockLoadModel.mockReturnValue(pending.promise);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    const loadButtons = wrapper.findAll("button").filter((b) => b.text() === "加载");
    expect(loadButtons).toHaveLength(2);
    await loadButtons[0].trigger("click");

    expect(mockLoadModel).toHaveBeenCalledTimes(1);
    expect(mockLoadModel).toHaveBeenCalledWith("m1");
    expect(wrapper.findAll("button").filter((b) => b.text() === "加载中…")).toHaveLength(1);
    for (const button of wrapper.findAll("button")) {
      expect(button.attributes("disabled")).toBeDefined();
    }

    pending.resolve();
    await flushPromises();
    expect(mockFetchModels.mock.calls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("卸载按钮显示卸载中状态", async () => {
    mockFetchModels.mockResolvedValue([model({ id: "m1", loaded: true })]);
    const pending = deferred<void>();
    mockUnloadModel.mockReturnValue(pending.promise);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    await buttonByText(wrapper, "卸载")!.trigger("click");
    expect(mockUnloadModel).toHaveBeenCalledTimes(1);
    expect(buttonByText(wrapper, "卸载中…")).toBeTruthy();

    pending.resolve();
    await flushPromises();
    wrapper.unmount();
  });

  it("下载请求立即进入忙碌状态，快速点击不会产生重复请求", async () => {
    mockFetchModels.mockResolvedValue([
      model({ id: "m1", name: "模型一", installed: false }),
    ]);
    const pending = deferred<void>();
    mockStartDownload.mockReturnValue(pending.promise);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    const downloadButton = buttonByText(wrapper, "下载")!;
    await downloadButton.trigger("click");
    await downloadButton.trigger("click");

    expect(mockStartDownload).toHaveBeenCalledTimes(1);
    expect(mockStartDownload).toHaveBeenCalledWith("m1");
    expect(buttonByText(wrapper, "下载请求中…")).toBeTruthy();

    pending.resolve();
    await flushPromises();
    wrapper.unmount();
  });

  it("有活动字幕任务时禁用模型操作并解释原因", async () => {
    mockFetchModels.mockResolvedValue([
      model({ id: "m1", installed: true }),
      model({ id: "m2", installed: false }),
    ]);

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: true } });
    await flushPromises();

    for (const button of wrapper.findAll("button")) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.text()).toContain("任务会自动加载所需模型");

    await buttonByText(wrapper, "加载")!.trigger("click");
    expect(mockLoadModel).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("ModelPanel 下载进度", () => {
  it("总大小已知时显示真实进度与百分比", async () => {
    mockFetchModels.mockResolvedValue([
      model({ id: "m1", installed: false }),
    ]);
    mockFetchProgress.mockResolvedValue({
      state: "running",
      model_id: "m1",
      downloaded_bytes: 524288,
      total_bytes: 1048576,
    });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    expect(wrapper.text()).toContain("正在下载 m1");
    expect(wrapper.text()).toContain("512.0 KiB");
    expect(wrapper.text()).toContain("1.0 MiB");
    expect(wrapper.text()).toContain("50%");
    expect(wrapper.find("progress").exists()).toBe(true);
    expect(buttonByText(wrapper, "下载中…")!.attributes("disabled")).toBeDefined();

    // 下载期间更频繁地轮询进度
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockFetchProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("总大小未知时显示已下载字节数和进行中状态", async () => {
    mockFetchProgress.mockResolvedValue({
      state: "running",
      model_id: "m1",
      downloaded_bytes: 1024,
    });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    expect(wrapper.text()).toContain("1.0 KiB");
    expect(wrapper.text()).toContain("总大小未知，下载进行中");
    expect(wrapper.find("progress").exists()).toBe(false);
    wrapper.unmount();
  });

  it("下载失败保留错误说明，提供刷新状态而非重试下载", async () => {
    mockFetchProgress.mockResolvedValue({
      state: "failed",
      model_id: "m1",
      error: "磁盘空间不足",
    });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("磁盘空间不足");
    expect(buttonByText(wrapper, "刷新状态")).toBeTruthy();
    expect(wrapper.text()).not.toContain("重试");

    mockFetchProgress.mockResolvedValue(idleProgress());
    await buttonByText(wrapper, "刷新状态")!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("磁盘空间不足");
    wrapper.unmount();
  });
});
