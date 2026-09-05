import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelPanel from "./ModelPanel.vue";
import type { ModelInfo } from "../types";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchModels: vi.fn(),
    fetchDownloadProgress: vi.fn(),
    startModelDownload: vi.fn(),
    loadModel: vi.fn(),
    unloadModel: vi.fn(),
  };
});

const api = await import("../api");

const fetchModels = vi.mocked(api.fetchModels);
const fetchDownloadProgress = vi.mocked(api.fetchDownloadProgress);
const startModelDownload = vi.mocked(api.startModelDownload);
const loadModel = vi.mocked(api.loadModel);
const unloadModel = vi.mocked(api.unloadModel);

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "ja-asr-v1",
    name: "日语转录模型",
    type: "asr",
    installed: true,
    loaded: false,
    mock: false,
    ...overrides,
  };
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchModels.mockReset();
  fetchDownloadProgress.mockReset();
  startModelDownload.mockReset();
  loadModel.mockReset();
  unloadModel.mockReset();
  fetchDownloadProgress.mockResolvedValue({ state: "idle" });
  fetchModels.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ModelPanel", () => {
  it("加载中显示提示，空列表显示暂无可用模型", async () => {
    fetchModels.mockResolvedValue([]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });

    expect(wrapper.text()).toContain("正在加载模型列表…");
    await flushPromises();
    expect(wrapper.text()).toContain("暂无可用模型。");
    wrapper.unmount();
  });

  it("加载模型时只有对应按钮显示加载中", async () => {
    fetchModels.mockResolvedValue([
      model({ id: "a", name: "模型 A" }),
      model({ id: "b", name: "模型 B" }),
    ]);
    loadModel.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    const buttons = wrapper.findAll("button");
    void buttons[0].trigger("click");
    await flushPromises();

    expect(wrapper.findAll("button")[0].text()).toBe("加载中…");
    expect(wrapper.findAll("button")[1].text()).toBe("加载");

    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(wrapper.findAll("button")[0].text()).toBe("加载");
    wrapper.unmount();
  });

  it("有活动字幕任务时禁用模型操作并解释原因", async () => {
    fetchModels.mockResolvedValue([model()]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: true } });
    await flushPromises();

    expect(findButton(wrapper, "加载")?.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
    wrapper.unmount();
  });

  it("连续点击下载只发起一次请求，并显示下载请求中", async () => {
    fetchModels.mockResolvedValue([model({ installed: false })]);
    startModelDownload.mockResolvedValue(undefined);
    // 首次挂载保持空闲，点击下载后才进入下载中。
    fetchDownloadProgress.mockResolvedValueOnce({ state: "idle" });
    fetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "ja-asr-v1",
      downloaded_bytes: 512,
      total_bytes: 1024,
    });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    const button = findButton(wrapper, "下载");
    void button!.trigger("click");
    void button!.trigger("click");
    await flushPromises();

    expect(startModelDownload).toHaveBeenCalledTimes(1);
    expect(findButton(wrapper, "下载请求中…")).toBeDefined();
    expect(wrapper.text()).toContain("50%");
    wrapper.unmount();
  });

  it("总大小未知时只显示已下载字节与进行中", async () => {
    fetchModels.mockResolvedValue([model({ installed: false })]);
    startModelDownload.mockResolvedValue(undefined);
    fetchDownloadProgress.mockResolvedValueOnce({ state: "idle" });
    fetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "ja-asr-v1",
      downloaded_bytes: 2 * 1024 * 1024,
    });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();
    await findButton(wrapper, "下载")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("2.0 MiB");
    expect(wrapper.text()).toContain("总大小未知，进行中");
    expect(wrapper.find("progress").exists()).toBe(false);
    wrapper.unmount();
  });

  it("下载失败保留错误说明并提供刷新状态", async () => {
    fetchModels.mockResolvedValue([model({ installed: false })]);
    startModelDownload.mockResolvedValue(undefined);
    fetchDownloadProgress.mockResolvedValue({
      state: "failed",
      model_id: "ja-asr-v1",
      error: "连接被重置",
    });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();
    await findButton(wrapper, "下载")!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("下载失败：连接被重置");
    expect(findButton(wrapper, "刷新状态")).toBeDefined();

    // 刷新状态只重新查询，不再发起下载。
    fetchDownloadProgress.mockResolvedValue({ state: "idle" });
    await findButton(wrapper, "刷新状态")!.trigger("click");
    await flushPromises();
    expect(startModelDownload).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
