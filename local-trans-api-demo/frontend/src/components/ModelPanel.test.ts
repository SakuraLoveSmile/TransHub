import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDownloadProgress,
  fetchModels,
  loadModel,
  startModelDownload,
  unloadModel,
  type DownloadProgress,
  type ModelInfo,
} from "../api";
import ModelPanel from "./ModelPanel.vue";

vi.mock("../api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  fetchDownloadProgress: vi.fn(),
  fetchModels: vi.fn(),
  loadModel: vi.fn(),
  startModelDownload: vi.fn(),
  unloadModel: vi.fn(),
}));

const IDLE: DownloadProgress = { state: "idle" };

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "sensevoice-small",
    name: "SenseVoice Small",
    type: "asr",
    installed: true,
    loaded: false,
    mock: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function mountSettled(
  models: ModelInfo[],
  progress: DownloadProgress = IDLE,
  hasActiveTasks = false,
) {
  vi.mocked(fetchModels).mockResolvedValue(models);
  vi.mocked(fetchDownloadProgress).mockResolvedValue(progress);
  const wrapper = mount(ModelPanel, { props: { hasActiveTasks } });
  await vi.advanceTimersByTimeAsync(0);
  return wrapper;
}

function labels(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("button").map((button) => button.text());
}

function buttonWithLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll("button").find((item) => item.text() === label);
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchModels).mockReset();
  vi.mocked(fetchDownloadProgress).mockReset();
  vi.mocked(loadModel).mockReset();
  vi.mocked(unloadModel).mockReset();
  vi.mocked(startModelDownload).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ModelPanel", () => {
  it("says the list is loading and then that no model exists", async () => {
    const pending = deferred<ModelInfo[]>();
    vi.mocked(fetchModels).mockReturnValue(pending.promise);
    vi.mocked(fetchDownloadProgress).mockResolvedValue(IDLE);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("正在加载模型列表…");
    expect(wrapper.text()).not.toContain("暂无可用模型");

    pending.resolve([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("暂无可用模型");
  });

  it("offers exactly one action per model state", async () => {
    const wrapper = await mountSettled([
      model({ id: "a", name: "A", installed: false }),
      model({ id: "b", name: "B", installed: true, loaded: true }),
    ]);

    expect(labels(wrapper)).toEqual(["刷新状态", "下载", "卸载"]);
    expect(wrapper.text()).toContain("未安装");
    expect(wrapper.text()).toContain("已加载");
  });

  it("marks only the pressed model as loading", async () => {
    const pending = deferred<void>();
    vi.mocked(loadModel).mockReturnValue(pending.promise);
    const wrapper = await mountSettled([
      model({ id: "a", name: "A" }),
      model({ id: "b", name: "B" }),
    ]);

    expect(labels(wrapper)).toEqual(["刷新状态", "加载", "加载"]);
    await buttonWithLabel(wrapper, "加载").trigger("click");

    expect(loadModel).toHaveBeenCalledWith("a");
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(labels(wrapper)).toEqual(["刷新状态", "加载中…", "加载"]);

    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(labels(wrapper)).toEqual(["刷新状态", "加载", "加载"]);
  });

  it("marks the loaded model as unloading", async () => {
    const pending = deferred<void>();
    vi.mocked(unloadModel).mockReturnValue(pending.promise);
    const wrapper = await mountSettled([model({ loaded: true })]);

    await buttonWithLabel(wrapper, "卸载").trigger("click");

    expect(unloadModel).toHaveBeenCalledTimes(1);
    expect(labels(wrapper)).toEqual(["刷新状态", "卸载中…"]);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("ignores a second click while a download request is in flight", async () => {
    const pending = deferred<void>();
    vi.mocked(startModelDownload).mockReturnValue(pending.promise);
    const wrapper = await mountSettled([model({ installed: false })]);

    expect(fetchModels).toHaveBeenCalledTimes(1);
    const downloadButton = buttonWithLabel(wrapper, "下载");
    await downloadButton.trigger("click");
    await downloadButton.trigger("click");

    expect(startModelDownload).toHaveBeenCalledTimes(1);
    expect(labels(wrapper)).toEqual(["刷新状态", "下载请求中…"]);

    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchModels).toHaveBeenCalledTimes(2);
    expect(labels(wrapper)).toEqual(["刷新状态", "下载"]);
  });

  it("locks model actions while subtitle tasks run and explains why", async () => {
    const wrapper = await mountSettled(
      [model({ id: "a", installed: false }), model({ id: "b", loaded: true })],
      IDLE,
      true,
    );

    expect(wrapper.text()).toContain("任务会自动加载所需模型");
    expect(buttonWithLabel(wrapper, "下载").attributes("disabled")).toBeDefined();
    expect(buttonWithLabel(wrapper, "卸载").attributes("disabled")).toBeDefined();
    expect(buttonWithLabel(wrapper, "刷新状态").attributes("disabled")).toBeUndefined();
  });

  it("shows real progress when the total size is known", async () => {
    const wrapper = await mountSettled(
      [model()],
      {
        state: "running",
        model_id: "sensevoice-small",
        downloaded_bytes: 512 * 1024,
        total_bytes: 1024 * 1024,
      },
    );

    const bar = wrapper.find("progress");
    expect(bar.exists()).toBe(true);
    expect(bar.attributes("value")).toBe(String(512 * 1024));
    expect(bar.attributes("max")).toBe(String(1024 * 1024));
    expect(wrapper.text()).toContain("正在下载 sensevoice-small（进行中）");
    expect(wrapper.text()).toContain("共 1.0 MiB");
    expect(wrapper.text()).not.toContain("总大小未知");
  });

  it("falls back to a byte counter when the total size is unknown", async () => {
    const wrapper = await mountSettled(
      [model()],
      { state: "running", model_id: "sensevoice-small", downloaded_bytes: 300 },
    );

    expect(wrapper.find("progress").exists()).toBe(false);
    expect(wrapper.text()).toContain("已下载 300 B");
    expect(wrapper.text()).toContain("总大小未知");
  });

  it("reports a finished download and refreshes the list", async () => {
    const wrapper = await mountSettled(
      [model()],
      { state: "done", model_id: "sensevoice-small" },
    );

    expect(wrapper.text()).toContain("下载完成，模型列表已刷新。");
    expect(wrapper.text()).not.toContain("正在下载");
  });

  it("keeps the download error and names the button 刷新状态 instead of 重试", async () => {
    const wrapper = await mountSettled(
      [model()],
      { state: "failed", model_id: "sensevoice-small", error: "网络中断" },
    );

    expect(wrapper.find('[role="alert"]').text()).toContain("下载失败：网络中断");
    expect(labels(wrapper)).toContain("刷新状态");
    expect(wrapper.text()).not.toContain("重试");

    await buttonWithLabel(wrapper, "刷新状态").trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDownloadProgress).toHaveBeenCalledTimes(2);
  });

  it("keeps the API error visible when the list request fails", async () => {
    vi.mocked(fetchModels).mockRejectedValue(new Error("模型列表格式非法。"));
    vi.mocked(fetchDownloadProgress).mockResolvedValue(IDLE);
    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.find('[role="alert"]').text()).toBe("模型列表格式非法。");
    expect(wrapper.text()).not.toContain("暂无可用模型");
  });

  it("stops polling after unmount", async () => {
    const wrapper = await mountSettled([model()]);
    expect(fetchModels).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchModels).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });
});
