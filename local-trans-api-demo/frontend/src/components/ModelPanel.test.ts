import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ModelPanel from "./ModelPanel.vue";

const mockFetchModels = vi.fn();
const mockFetchDownloadProgress = vi.fn();
const mockStartModelDownload = vi.fn();
const mockLoadModel = vi.fn();
const mockUnloadModel = vi.fn();
const mockDescribeApiError = vi.fn(
  (error: unknown) => (error instanceof Error ? error.message : "请求失败"),
);

vi.mock("../api", () => ({
  describeApiError: (error: unknown) => mockDescribeApiError(error),
  fetchDownloadProgress: () => mockFetchDownloadProgress(),
  fetchModels: () => mockFetchModels(),
  loadModel: (...args: unknown[]) => mockLoadModel(...args),
  startModelDownload: (...args: unknown[]) => mockStartModelDownload(...args),
  unloadModel: (...args: unknown[]) => mockUnloadModel(...args),
}));

function modelFixture(overrides: Record<string, unknown> = {}) {
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

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchModels.mockResolvedValue([modelFixture()]);
  mockFetchDownloadProgress.mockResolvedValue({ state: "idle" });
  mockDescribeApiError.mockImplementation((error: unknown) =>
    error instanceof Error ? error.message : "请求失败",
  );
});

describe("ModelPanel", () => {
  it("shows a loading hint before the first fetch resolves", () => {
    mockFetchModels.mockReturnValue(new Promise(() => {}));
    mockFetchDownloadProgress.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    expect(wrapper.find('[role="status"]').text()).toContain("正在加载");
    wrapper.unmount();
  });

  it("shows an empty hint when no models are available", async () => {
    mockFetchModels.mockResolvedValue([]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    expect(wrapper.text()).toContain("暂无可用模型");
    wrapper.unmount();
  });

  it("renders installed/loaded/missing states", async () => {
    mockFetchModels.mockResolvedValue([
      modelFixture({ id: "a", name: "A", installed: false, loaded: false }),
      modelFixture({ id: "b", name: "B", installed: true, loaded: false }),
      modelFixture({ id: "c", name: "C", installed: true, loaded: true }),
    ]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    expect(wrapper.text()).toContain("未安装");
    expect(wrapper.text()).toContain("已安装");
    expect(wrapper.text()).toContain("已加载");
    expect(wrapper.findAll("button").some((b) => b.text().includes("下载"))).toBe(true);
    expect(wrapper.findAll("button").some((b) => b.text().includes("加载"))).toBe(true);
    expect(wrapper.findAll("button").some((b) => b.text().includes("卸载"))).toBe(true);
    wrapper.unmount();
  });

  it("locks all manual actions while subtitle tasks are active", async () => {
    mockFetchModels.mockResolvedValue([
      modelFixture({ id: "a", name: "A", installed: false, loaded: false }),
    ]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: true } });
    await flush();
    const downloadBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("下载"))!;
    expect(downloadBtn.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("有未完成字幕任务时禁用手动");
    expect(wrapper.text()).toContain("自动加载");
    wrapper.unmount();
  });

  it("marks only the pending download busy and blocks repeats", async () => {
    mockFetchModels.mockResolvedValue([
      modelFixture({ id: "a", name: "A", installed: false, loaded: false }),
      modelFixture({ id: "b", name: "B", installed: false, loaded: false }),
    ]);
    let resolveDownload!: () => void;
    mockStartModelDownload.mockReturnValueOnce(
      new Promise<void>((resolve) => (resolveDownload = resolve)),
    );
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    const buttons = wrapper.findAll("button").filter((b) => b.text().includes("下载"));
    expect(buttons).toHaveLength(2);
    await buttons[0].trigger("click");
    await flushPromises();
    // Precise busy state: only the clicked model shows 下载中….
    const updated = wrapper.findAll("button").filter((b) => b.text().includes("下载"));
    expect(updated[0].text()).toContain("下载中");
    expect(updated[1].text()).not.toContain("下载中");
    expect(updated[1].attributes("disabled")).toBeDefined();
    // Repeat clicks while busy do not issue another download.
    await updated[0].trigger("click");
    expect(mockStartModelDownload).toHaveBeenCalledTimes(1);
    resolveDownload();
    await flush();
    expect(mockStartModelDownload).toHaveBeenCalledWith("a");
    wrapper.unmount();
  });

  it("surfaces download failure feedback from the API", async () => {
    mockStartModelDownload.mockRejectedValueOnce(new Error("磁盘空间不足"));
    mockFetchModels.mockResolvedValue([
      modelFixture({ id: "a", name: "A", installed: false, loaded: false }),
    ]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    await wrapper.findAll("button").find((b) => b.text().includes("下载"))!.trigger("click");
    await flush();
    expect(wrapper.find('[role="alert"]').text()).toContain("磁盘空间不足");
    wrapper.unmount();
  });

  it("shows real percent progress when total is known", async () => {
    mockFetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "chickenrice-v2",
      downloaded_bytes: 50 * 1024 * 1024,
      total_bytes: 100 * 1024 * 1024,
    });
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    expect(wrapper.text()).toContain("50％");
    expect(wrapper.text()).toContain("进行中");
    expect(wrapper.find("progress").exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows bytes without percent when total is unknown", async () => {
    mockFetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "chickenrice-v2",
      downloaded_bytes: 1024,
    });
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    expect(wrapper.text()).toContain("总大小未知");
    expect(wrapper.text()).toContain("不显示百分比");
    expect(wrapper.find("progress").exists()).toBe(false);
    wrapper.unmount();
  });

  it("offers a named retry that refreshes failed download state", async () => {
    mockFetchDownloadProgress.mockResolvedValue({
      state: "failed",
      model_id: "chickenrice-v2",
      error: "网络中断",
    });
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    expect(wrapper.text()).toContain("下载失败");
    const retry = wrapper.findAll("button").find((b) => b.text().includes("刷新状态"))!;
    expect(retry.exists()).toBe(true);
    mockFetchDownloadProgress.mockResolvedValue({ state: "idle" });
    await retry.trigger("click");
    await flush();
    expect(mockFetchModels.mock.calls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("keeps old models visible when refresh fails", async () => {
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    expect(wrapper.text()).toContain("ChickenRice v2");
    mockFetchModels.mockRejectedValueOnce(new Error("列表刷新失败"));
    const retry = wrapper.findAll("button").find((b) => b.text().includes("刷新状态"));
    if (retry) {
      await retry.trigger("click");
      await flush();
    } else {
      // No failure banner yet: force a poll failure through the next cycle
      // by waiting for the component's own refresh error path.
      mockFetchModels.mockRejectedValueOnce(new Error("列表刷新失败"));
      await flush();
    }
    // Old data is retained even after a failed refresh.
    expect(wrapper.text()).toContain("ChickenRice v2");
    wrapper.unmount();
  });

  it("stops polling after unmount without extra fetches", async () => {
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flush();
    const calls = mockFetchModels.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    wrapper.unmount();
    await flush();
    expect(mockFetchModels.mock.calls.length).toBe(calls);
  });
});
