import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../api";

const {
  fetchModels,
  fetchDownloadProgress,
  loadModel,
  unloadModel,
  startModelDownload,
} = vi.hoisted(() => ({
  fetchModels: vi.fn(),
  fetchDownloadProgress: vi.fn(),
  loadModel: vi.fn(),
  unloadModel: vi.fn(),
  startModelDownload: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchModels,
    fetchDownloadProgress,
    loadModel,
    unloadModel,
    startModelDownload,
  };
});

import ModelPanel from "./ModelPanel.vue";

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "chickenrice-v2",
    name: "Chicken Rice v2",
    type: "sensevoice",
    installed: true,
    loaded: false,
    mock: false,
    ...overrides,
  };
}

beforeEach(() => {
  fetchModels.mockResolvedValue([makeModel()]);
  fetchDownloadProgress.mockResolvedValue({ state: "idle" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ModelPanel", () => {
  it("shows a loading hint before the first response", () => {
    fetchModels.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(ModelPanel);

    expect(wrapper.text()).toContain("正在加载模型列表…");
    wrapper.unmount();
  });

  it("renders the model list with install states", async () => {
    fetchModels.mockResolvedValue([
      makeModel({ loaded: true }),
      makeModel({ installed: false }),
    ]);
    const wrapper = mount(ModelPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("Chicken Rice v2");
    expect(wrapper.text()).toContain("已加载");
    expect(wrapper.text()).toContain("未安装");
  });

  it("explains when no models are available", async () => {
    fetchModels.mockResolvedValue([]);
    const wrapper = mount(ModelPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("暂无可用模型");
  });

  it("shows the pending label only on the operating model", async () => {
    let resolveLoad: () => void = () => {};
    loadModel.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    fetchModels.mockResolvedValue([
      makeModel(),
      makeModel({ id: "other", name: "Other" }),
    ]);

    const wrapper = mount(ModelPanel);
    await flushPromises();

    const loadButtons = wrapper
      .findAll("button")
      .filter((b) => b.text() === "加载" || b.text() === "加载中…");
    expect(loadButtons).toHaveLength(2);

    await loadButtons[0].trigger("click");
    await flushPromises();

    const buttonsNow = wrapper.findAll("button");
    expect(buttonsNow.filter((b) => b.text() === "加载中…")).toHaveLength(1);
    expect(buttonsNow.filter((b) => b.text() === "加载")).toHaveLength(1);

    resolveLoad();
    await flushPromises();
    expect(loadModel).toHaveBeenCalledWith("chickenrice-v2");
  });

  it("disables operations while subtitle tasks are active", async () => {
    const wrapper = mount(ModelPanel, {
      props: { hasActiveTasks: true },
    });
    await flushPromises();

    const buttons = wrapper
      .findAll("button")
      .filter((b) => ["下载", "加载", "卸载"].includes(b.text()));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.attributes("disabled")).toBeDefined();
    }
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
  });

  it("starts downloads with an immediate busy state", async () => {
    let resolveDownload: () => void = () => {};
    startModelDownload.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDownload = resolve;
      }),
    );
    fetchModels.mockResolvedValue([makeModel({ installed: false })]);

    const wrapper = mount(ModelPanel);
    await flushPromises();

    const downloadButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "下载");
    await downloadButton?.trigger("click");
    await flushPromises();

    expect(
      wrapper
        .findAll("button")
        .find((b) => b.text() === "下载请求中…"),
    ).toBeDefined();

    resolveDownload();
    await flushPromises();
    expect(startModelDownload).toHaveBeenCalledWith("chickenrice-v2");
  });

  it("shows real progress when the total size is known", async () => {
    fetchDownloadProgress.mockResolvedValue({
      state: "running",
      model_id: "chickenrice-v2",
      downloaded_bytes: 1024 * 1024 * 100,
      total_bytes: 1024 * 1024 * 400,
    });

    const wrapper = mount(ModelPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("已下载 100.0 MiB");
    expect(wrapper.text()).toContain("共 400.0 MiB");
    expect(wrapper.find("progress").exists()).toBe(true);
  });

  it("offers a status refresh instead of implying a re-download", async () => {
    fetchDownloadProgress.mockResolvedValue({
      state: "failed",
      model_id: "chickenrice-v2",
      error: "磁盘空间不足",
    });

    const wrapper = mount(ModelPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("下载失败：磁盘空间不足");
    const refresh = wrapper
      .findAll("button")
      .find((b) => b.text() === "刷新状态");
    expect(refresh).toBeDefined();

    fetchDownloadProgress.mockResolvedValue({ state: "idle" });
    await refresh?.trigger("click");
    await flushPromises();
    expect(fetchDownloadProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
