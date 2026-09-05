import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ModelPanel from "./ModelPanel.vue";
import type { ModelInfo } from "../types";

const mockFetchModels = vi.fn();
const mockFetchDownloadProgress = vi.fn();
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockStartModelDownload = vi.fn();

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败",
  fetchModels: (...args: unknown[]) => mockFetchModels(...args),
  fetchDownloadProgress: (...args: unknown[]) => mockFetchDownloadProgress(...args),
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  unloadModel: (...args: unknown[]) => mockUnloadModel(...args),
  startModelDownload: (...args: unknown[]) => mockStartModelDownload(...args),
}));

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "chickenrice-v2",
    name: "ChickenRice v2",
    type: "transcribe",
    installed: true,
    loaded: false,
    mock: false,
    ...overrides,
  };
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) await flushPromises();
  await Promise.resolve();
}

function mountPanel(hasActiveTasks = false) {
  return mount(ModelPanel, { props: { hasActiveTasks } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchModels.mockResolvedValue([model()]);
  mockFetchDownloadProgress.mockResolvedValue({ state: "idle" });
  mockLoadModel.mockResolvedValue(undefined);
  mockUnloadModel.mockResolvedValue(undefined);
  mockStartModelDownload.mockResolvedValue(undefined);
});

describe("ModelPanel", () => {
  it("shows loading hint then the model list", async () => {
    let resolveModels!: (v: ModelInfo[]) => void;
    mockFetchModels.mockReturnValue(
      new Promise<ModelInfo[]>((resolve) => (resolveModels = resolve)),
    );
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("正在加载模型列表");
    resolveModels([model()]);
    await flush();
    expect(wrapper.text()).toContain("ChickenRice v2");
    expect(wrapper.text()).toContain("chickenrice-v2");
    wrapper.unmount();
  });

  it("shows empty-state message when the API returns no models", async () => {
    mockFetchModels.mockResolvedValue([]);
    const wrapper = mountPanel();
    await flush();
    expect(wrapper.text()).toContain("暂无可用模型");
    wrapper.unmount();
  });

  it("uses pendingModelId + explicit action labels on the correct button", async () => {
    let resolveLoad!: (v: undefined) => void;
    mockLoadModel.mockReturnValue(
      new Promise<undefined>((resolve) => (resolveLoad = resolve)),
    );
    const wrapper = mountPanel();
    await flush();
    const loadBtn = wrapper.findAll("button").find((b) => b.text().includes("加载"))!;
    await loadBtn.trigger("click");
    await flushPromises();
    // Only the clicked load button shows 加载中; others unchanged.
    expect(loadBtn.text()).toContain("加载中");
    resolveLoad(undefined);
    await flush();
    wrapper.unmount();
  });

  it("sets busy before the request so rapid clicks do not double-fire", async () => {
    let resolveLoad!: (v: undefined) => void;
    mockLoadModel.mockReturnValue(
      new Promise<undefined>((resolve) => (resolveLoad = resolve)),
    );
    const wrapper = mountPanel();
    await flush();
    const loadBtn = wrapper.findAll("button").find((b) => b.text().includes("加载"))!;
    await loadBtn.trigger("click");
    await loadBtn.trigger("click");
    expect(mockLoadModel).toHaveBeenCalledTimes(1);
    resolveLoad(undefined);
    await flush();
    wrapper.unmount();
  });

  it("disables load and unload while active tasks exist (model limit hint)", async () => {
    const wrapper = mountPanel(true);
    await flush();
    wrapper.findAll("button").forEach((b) => {
      expect(b.attributes("disabled")).toBeDefined();
    });
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
    wrapper.unmount();
  });

  it("unload button appears for loaded models and triggers unloadModel", async () => {
    mockFetchModels.mockResolvedValue([model({ loaded: true })]);
    let resolveUnload!: (v: undefined) => void;
    mockUnloadModel.mockReturnValue(
      new Promise<undefined>((resolve) => (resolveUnload = resolve)),
    );
    const wrapper = mountPanel();
    await flush();
    const unloadBtn = wrapper.findAll("button").find((b) => b.text().includes("卸载"))!;
    await unloadBtn.trigger("click");
    expect(unloadBtn.text()).toContain("卸载中");
    expect(mockUnloadModel).toHaveBeenCalledTimes(1);
    resolveUnload(undefined);
    await flush();
    wrapper.unmount();
  });

  it("download button for missing models shows 下载请求中 and double-click fires once", async () => {
    mockFetchModels.mockResolvedValue([model({ installed: false })]);
    let resolveDownload!: (v: undefined) => void;
    mockStartModelDownload.mockReturnValue(
      new Promise<undefined>((resolve) => (resolveDownload = resolve)),
    );
    const wrapper = mountPanel();
    await flush();
    const downloadBtn = wrapper.findAll("button").find((b) => b.text().includes("下载"))!;
    await downloadBtn.trigger("click");
    await downloadBtn.trigger("click");
    expect(downloadBtn.text()).toContain("下载请求中");
    expect(mockStartModelDownload).toHaveBeenCalledTimes(1);
    resolveDownload(undefined);
    await flush();
    wrapper.unmount();
  });

  it("shows real progress bar when total bytes are known and text when unknown", async () => {
    mockFetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "chickenrice-v2",
      downloaded_bytes: 512 * 1024 * 1024,
      total_bytes: 1024 * 1024 * 1024,
    });
    const wrapper = mountPanel();
    await flush();
    expect(wrapper.find("progress").exists()).toBe(true);
    expect(wrapper.text()).toContain("50%");
    expect(wrapper.text()).toContain("进行中");
    wrapper.unmount();
  });

  it("shows bytes text without percent when total is unknown", async () => {
    mockFetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "chickenrice-v2",
      downloaded_bytes: 1024,
      total_bytes: undefined,
    });
    const wrapper = mountPanel();
    await flush();
    expect(wrapper.find("progress").exists()).toBe(false);
    expect(wrapper.text()).toContain("1.0 KiB");
    expect(wrapper.text()).toContain("总大小未知");
    expect(wrapper.text()).not.toContain("100%");
    wrapper.unmount();
  });

  it("shows download failure with a 刷新状态 button (not a retry)", async () => {
    mockFetchDownloadProgress.mockResolvedValue({
      state: "failed",
      error: "网络中断",
    });
    const wrapper = mountPanel();
    await flush();
    expect(wrapper.text()).toContain("下载失败");
    expect(wrapper.text()).toContain("网络中断");
    const refreshBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("刷新状态"))!;
    expect(refreshBtn.exists()).toBe(true);
    expect(wrapper.text()).not.toContain("重试");
    wrapper.unmount();
  });

  it("keeps errors on failed refresh and clears on success", async () => {
    mockFetchDownloadProgress.mockResolvedValueOnce({ state: "failed", error: "x" });
    mockFetchModels.mockResolvedValueOnce([model()]);
    let resolveProgress!: (v: { state: string; error: string }) => void;
    mockFetchDownloadProgress.mockReturnValueOnce(
      new Promise((resolve) => (resolveProgress = resolve)),
    );
    const wrapper = mountPanel();
    await flush();
    expect(wrapper.text()).toContain("下载失败");
    // Clicking 刷新状态 starts a refresh; the fetch is pending.
    const refreshBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("刷新状态"))!;
    await refreshBtn.trigger("click");
    resolveProgress({ state: "idle", error: "" });
    await flush();
    expect(wrapper.text()).not.toContain("下载失败");
    wrapper.unmount();
  });

  it("stops polling after unmount", async () => {
    const wrapper = mountPanel();
    await flush();
    const calls = mockFetchModels.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    wrapper.unmount();
    await flush();
    expect(mockFetchModels.mock.calls.length).toBe(calls);
  });
});
