import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelPanel from "./ModelPanel.vue";
import type { DownloadProgress, ModelInfo } from "../types";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败",
  fetchDownloadProgress: vi.fn(),
  fetchModels: vi.fn(),
  loadModel: vi.fn(),
  startModelDownload: vi.fn(),
  unloadModel: vi.fn(),
}));

import {
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
} from "../api";

const mockedFetchDownloadProgress = vi.mocked(fetchDownloadProgress);
const mockedFetchModels = vi.mocked(fetchModels);
const mockedLoadModel = vi.mocked(loadModel);
const mockedStartModelDownload = vi.mocked(startModelDownload);

const installedModel: ModelInfo = {
  id: "whisper-ja-1.5b",
  name: "Whisper Japanese 1.5B",
  type: "transcription",
  installed: true,
  loaded: false,
  mock: true,
};

const missingModel: ModelInfo = {
  id: "chickenrice-v2",
  name: "ChickenRice v2",
  type: "translation",
  installed: false,
  loaded: false,
  mock: true,
};

const idleProgress: DownloadProgress = { state: "idle" };

describe("ModelPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedFetchModels.mockResolvedValue([installedModel]);
    mockedFetchDownloadProgress.mockResolvedValue(idleProgress);
    mockedLoadModel.mockResolvedValue(undefined);
    mockedStartModelDownload.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows loading, empty, and refresh failure states", async () => {
    let resolveModels!: (value: ModelInfo[]) => void;
    mockedFetchModels.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveModels = resolve;
      }),
    );
    const loading = mount(ModelPanel, { props: { hasActiveTasks: false } });
    expect(loading.text()).toContain("正在加载模型状态");
    resolveModels([]);
    await flushPromises();
    expect(loading.text()).toContain("暂无可用模型");
    loading.unmount();

    mockedFetchModels.mockRejectedValueOnce(new Error("服务离线"));
    const failed = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();
    expect(failed.find('[role="alert"]').text()).toContain("服务离线");
    failed.unmount();
  });

  it("uses an action-specific pending label and blocks repeated loads", async () => {
    let resolveLoad!: () => void;
    mockedLoadModel.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    const loadButton = wrapper.findAll("button").find((button) => button.text() === "加载");
    expect(loadButton).toBeDefined();
    await loadButton!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("加载中");
    expect(wrapper.findAll("button").filter((button) => button.text().includes("加载中")).length).toBe(1);

    await loadButton!.trigger("click");
    expect(mockedLoadModel).toHaveBeenCalledTimes(1);
    resolveLoad();
    await flushPromises();
    wrapper.unmount();
  });

  it("shows real and unknown download progress, and does not call it twice", async () => {
    mockedFetchModels.mockResolvedValue([missingModel]);
    mockedFetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: missingModel.id,
      downloaded_bytes: 512,
    });
    const running = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();
    expect(running.text()).toContain("总大小未知");
    running.unmount();

    mockedFetchDownloadProgress.mockResolvedValue(idleProgress);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    let resolveDownload!: () => void;
    mockedStartModelDownload.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
    );
    const downloadButton = wrapper.findAll("button").find((button) => button.text().includes("下载"));
    expect(downloadButton).toBeDefined();
    await downloadButton!.trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("下载请求中");
    expect(downloadButton!.attributes("disabled")).toBeDefined();
    await downloadButton!.trigger("click");
    expect(mockedStartModelDownload).toHaveBeenCalledTimes(1);
    resolveDownload();
    await flushPromises();
    wrapper.unmount();
  });

  it("keeps model operations disabled while tasks are active", async () => {
    mockedFetchModels.mockResolvedValue([installedModel, missingModel]);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: true } });
    await flushPromises();
    const operationButtons = wrapper.findAll("button").filter((button) =>
      ["加载", "下载"].some((label) => button.text().includes(label)),
    );
    expect(operationButtons.length).toBeGreaterThan(0);
    for (const button of operationButtons) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
    wrapper.unmount();
  });
});
