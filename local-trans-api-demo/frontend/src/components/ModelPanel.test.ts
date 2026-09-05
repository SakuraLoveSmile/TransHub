import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadProgress, ModelInfo } from "../api";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  fetchModels: vi.fn(),
  fetchDownloadProgress: vi.fn(),
  loadModel: vi.fn(),
  unloadModel: vi.fn(),
  startModelDownload: vi.fn(),
}));

import {
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
} from "../api";
import ModelPanel from "./ModelPanel.vue";

const mockedModels = vi.mocked(fetchModels);
const mockedProgress = vi.mocked(fetchDownloadProgress);
const mockedLoad = vi.mocked(loadModel);
const mockedUnload = vi.mocked(unloadModel);
const mockedDownload = vi.mocked(startModelDownload);

const missing: ModelInfo = {
  id: "whisper-ja-1.5b",
  name: "Whisper 日语 1.5B",
  type: "transcription",
  installed: false,
  loaded: false,
  mock: false,
};
const installed: ModelInfo = {
  id: "chickenrice-v2",
  name: "ChickenRice v2",
  type: "translation",
  installed: true,
  loaded: false,
  mock: false,
};
const loaded: ModelInfo = {
  id: "loaded-model",
  name: "已加载模型",
  type: "translation",
  installed: true,
  loaded: true,
  mock: false,
};

function mountPanel(hasActiveTasks = false) {
  return mount(ModelPanel, { props: { hasActiveTasks } });
}

function findButton(wrapper: ReturnType<typeof mountPanel>, text: string) {
  return wrapper.findAll("button").find((b) => b.text() === text);
}

beforeEach(() => {
  // 仅 fake setTimeout/clearTimeout，保留 setImmediate 让 flushPromises 正常解析。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedModels.mockReset();
  mockedProgress.mockReset();
  mockedLoad.mockReset();
  mockedUnload.mockReset();
  mockedDownload.mockReset();
  mockedModels.mockResolvedValue([missing, installed, loaded]);
  mockedProgress.mockResolvedValue({ state: "idle" } as DownloadProgress);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ModelPanel", () => {
  it("shows a loading hint while the first request is in flight", async () => {
    let resolveModels: (value: ModelInfo[]) => void = () => {};
    mockedModels.mockImplementation(
      () =>
        new Promise<ModelInfo[]>((resolve) => {
          resolveModels = resolve;
        }),
    );

    const wrapper = mountPanel();
    // onMounted 中同步置 isLoading，等待一次 DOM 刷新后才会渲染加载提示。
    await flushPromises();
    expect(wrapper.text()).toContain("正在加载模型列表");

    resolveModels([missing]);
    await flushPromises();
  });

  it("shows an empty hint when the service returns no models", async () => {
    mockedModels.mockResolvedValue([]);
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("暂无可用模型");
  });

  it("marks the pending load button only", async () => {
    let resolveLoad: () => void = () => {};
    mockedLoad.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const wrapper = mountPanel();
    await flushPromises();

    await findButton(wrapper, "加载")!.trigger("click");
    await flushPromises();

    expect(mockedLoad).toHaveBeenCalledWith("chickenrice-v2");
    expect(findButton(wrapper, "加载中…")).toBeTruthy();
    // 其余按钮不受影响。
    expect(findButton(wrapper, "下载")).toBeTruthy();

    resolveLoad();
    await flushPromises();
  });

  it("marks the pending unload button only", async () => {
    let resolveUnload: () => void = () => {};
    mockedUnload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUnload = resolve;
        }),
    );

    const wrapper = mountPanel();
    await flushPromises();

    await findButton(wrapper, "卸载")!.trigger("click");
    await flushPromises();

    expect(findButton(wrapper, "卸载中…")).toBeTruthy();
    resolveUnload();
    await flushPromises();
  });

  it("sets busy immediately on download and ignores rapid re-clicks", async () => {
    let resolveDownload: () => void = () => {};
    mockedDownload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const wrapper = mountPanel();
    await flushPromises();

    const downloadBtn = findButton(wrapper, "下载")!;
    await downloadBtn.trigger("click");
    await downloadBtn.trigger("click");
    await flushPromises();

    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(findButton(wrapper, "下载请求中…")).toBeTruthy();

    resolveDownload();
    await flushPromises();
  });

  it("refreshes the model list after a successful download", async () => {
    mockedDownload.mockResolvedValue(undefined);
    const wrapper = mountPanel();
    await flushPromises();
    const initialCalls = mockedModels.mock.calls.length;

    await findButton(wrapper, "下载")!.trigger("click");
    await flushPromises();

    expect(mockedModels.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("keeps the error message when a download fails to start", async () => {
    mockedDownload.mockRejectedValue(new Error("队列已满"));
    const wrapper = mountPanel();
    await flushPromises();

    await findButton(wrapper, "下载")!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("队列已满");
  });

  it("disables operations and explains while subtitle tasks are active", async () => {
    const wrapper = mountPanel(true);
    await flushPromises();

    expect(findButton(wrapper, "加载")!.attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "卸载")!.attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "下载")!.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
  });

  it("renders a real progress bar when the total size is known", async () => {
    mockedProgress.mockResolvedValue({
      state: "running",
      model_id: "whisper-ja-1.5b",
      downloaded_bytes: 50,
      total_bytes: 100,
    } as DownloadProgress);

    const wrapper = mountPanel();
    await flushPromises();

    const progress = wrapper.find("progress");
    expect(progress.exists()).toBe(true);
    expect(progress.attributes("value")).toBe("50");
    expect(progress.attributes("max")).toBe("100");
    expect(wrapper.text()).toContain("正在下载 whisper-ja-1.5b");
  });

  it("shows downloaded bytes without a bar when the total is unknown", async () => {
    mockedProgress.mockResolvedValue({
      state: "running",
      model_id: "whisper-ja-1.5b",
      downloaded_bytes: 2048,
    } as DownloadProgress);

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find("progress").exists()).toBe(false);
    expect(wrapper.text()).toContain("总大小未知");
    expect(wrapper.text()).toContain("2.0 KiB");
  });

  it("labels the failed-download action as 刷新状态, not 重试", async () => {
    mockedProgress.mockResolvedValue({
      state: "failed",
      error: "磁盘空间不足",
    } as DownloadProgress);

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.text()).toContain("下载失败：磁盘空间不足");
    expect(wrapper.text()).not.toContain("重试（重新查询状态）");
    expect(findButton(wrapper, "刷新状态")).toBeTruthy();
  });
});
