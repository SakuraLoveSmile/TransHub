import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelPanel from "./ModelPanel.vue";
import {
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
  type ModelInfo,
} from "../api";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  fetchModels: vi.fn(),
  fetchDownloadProgress: vi.fn(),
  loadModel: vi.fn(),
  unloadModel: vi.fn(),
  startModelDownload: vi.fn(),
}));

const mockModels = vi.mocked(fetchModels);
const mockProgress = vi.mocked(fetchDownloadProgress);
const mockLoad = vi.mocked(loadModel);
const mockUnload = vi.mocked(unloadModel);
const mockStartDownload = vi.mocked(startModelDownload);

const modelInstalled: ModelInfo = {
  id: "model-a",
  name: "模型 A",
  type: "asr",
  installed: true,
  loaded: false,
  mock: false,
};

const modelMissing: ModelInfo = {
  id: "model-b",
  name: "模型 B",
  type: "asr",
  installed: false,
  loaded: false,
  mock: true,
};

const modelLoaded: ModelInfo = {
  id: "model-c",
  name: "模型 C",
  type: "asr",
  installed: true,
  loaded: true,
  mock: false,
};

function findButton(
  wrapper: VueWrapper<InstanceType<typeof ModelPanel>>,
  label: string,
) {
  const button = wrapper.findAll("button").find((item) => item.text() === label);
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

async function mountedPanel(hasActiveTasks = false) {
  const wrapper = mount(ModelPanel, { props: { hasActiveTasks } });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockModels.mockResolvedValue([modelInstalled, modelMissing, modelLoaded]);
  mockProgress.mockResolvedValue({ state: "idle" });
});

describe("ModelPanel", () => {
  it("shows a loading hint until the model list resolves", async () => {
    let resolveList: (value: ModelInfo[]) => void = () => {};
    mockModels.mockImplementation(
      () =>
        new Promise<ModelInfo[]>((resolve) => {
          resolveList = resolve;
        }),
    );

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    expect(wrapper.text()).toContain("正在加载模型列表…");

    resolveList([modelInstalled]);
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("模型 A");
    wrapper.unmount();
  });

  it("explains when no models are available", async () => {
    mockModels.mockResolvedValue([]);
    const wrapper = await mountedPanel();
    expect(wrapper.text()).toContain("暂无可用模型。");
    wrapper.unmount();
  });

  it("shows list errors via role=alert", async () => {
    mockModels.mockRejectedValue(new Error("服务断开"));
    const wrapper = await mountedPanel();
    expect(wrapper.find('[role="alert"]').text()).toContain("服务断开");
    wrapper.unmount();
  });

  it("marks only the pending model as loading and blocks other actions", async () => {
    const wrapper = await mountedPanel();
    let resolveLoad: () => void = () => {};
    mockLoad.mockImplementation(
      () => new Promise<void>((resolve) => (resolveLoad = resolve)),
    );

    await findButton(wrapper, "加载").trigger("click");

    expect(wrapper.text()).toContain("加载中…");
    expect(wrapper.text()).not.toContain("卸载中…");
    expect(findButton(wrapper, "加载中…").attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "卸载").attributes("disabled")).toBeDefined();
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledWith("model-a");

    resolveLoad();
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("加载");
    expect(wrapper.text()).not.toContain("加载中…");
    // 成功后重新拉取模型列表。
    expect(mockModels.mock.calls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("shows unloading feedback on the loaded model", async () => {
    const wrapper = await mountedPanel();
    let resolveUnload: () => void = () => {};
    mockUnload.mockImplementation(
      () => new Promise<void>((resolve) => (resolveUnload = resolve)),
    );

    await findButton(wrapper, "卸载").trigger("click");
    expect(wrapper.text()).toContain("卸载中…");
    expect(mockUnload).toHaveBeenCalledTimes(1);

    resolveUnload();
    await flushPromises();
    await flushPromises();
    wrapper.unmount();
  });

  it("sets the download busy state before awaiting the request", async () => {
    const wrapper = await mountedPanel();
    let resolveDownload: () => void = () => {};
    mockStartDownload.mockImplementation(
      () => new Promise<void>((resolve) => (resolveDownload = resolve)),
    );

    const downloadButton = findButton(wrapper, "下载");
    await downloadButton.trigger("click");

    // 请求尚未返回时按钮已进入忙碌状态，快速点击不会重复发请求。
    expect(wrapper.text()).toContain("下载请求中…");
    expect(
      findButton(wrapper, "下载请求中…").attributes("disabled"),
    ).toBeDefined();
    await downloadButton.trigger("click");
    expect(mockStartDownload).toHaveBeenCalledTimes(1);
    expect(mockStartDownload).toHaveBeenCalledWith("model-b");

    mockProgress.mockResolvedValue({
      state: "running",
      model_id: "model-b",
      downloaded_bytes: 5 * 1024 * 1024,
    });
    resolveDownload();
    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).toContain("已下载 5.0 MiB，总大小未知");
    expect(wrapper.find("progress").exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders a real progress bar when the total size is known", async () => {
    mockProgress.mockResolvedValue({
      state: "running",
      model_id: "model-b",
      downloaded_bytes: 1024 * 1024,
      total_bytes: 10 * 1024 * 1024,
    });
    const wrapper = await mountedPanel();

    expect(wrapper.text()).toContain("已下载 1.0 MiB ／ 共 10.0 MiB");
    expect(wrapper.find("progress").exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers a status refresh instead of implying a re-download on failure", async () => {
    mockProgress.mockResolvedValue({ state: "failed", error: "磁盘已满" });
    const wrapper = await mountedPanel();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.text()).toContain("下载失败：磁盘已满");
    const button = wrapper
      .findAll("button")
      .find((item) => item.text() === "刷新状态");
    expect(button).toBeDefined();
    expect(wrapper.text()).not.toContain("重试");

    mockModels.mockResolvedValue([modelInstalled]);
    await button!.trigger("click");
    await flushPromises();
    await flushPromises();
    expect(mockModels.mock.calls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("pauses model operations while subtitle tasks are active", async () => {
    const wrapper = await mountedPanel(true);

    expect(findButton(wrapper, "加载").attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "卸载").attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "下载").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
    wrapper.unmount();
  });
});
