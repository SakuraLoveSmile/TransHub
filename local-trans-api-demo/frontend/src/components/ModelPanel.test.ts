import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import ModelPanel from "./ModelPanel.vue";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchModels: vi.fn(),
    fetchDownloadProgress: vi.fn(),
    startModelDownload: vi.fn(),
    loadModel: vi.fn(),
  };
});

describe("ModelPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.fetchModels).mockResolvedValue([]);
    vi.mocked(api.fetchDownloadProgress).mockResolvedValue({ state: "idle" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("模型操作和下载反馈", async () => {
    const models = [
      { id: "1", name: "Model 1", installed: false, loaded: false, mock: false, type: "test" }
    ];
    vi.mocked(api.fetchModels).mockResolvedValue(models);
    vi.mocked(api.fetchDownloadProgress).mockResolvedValue({ state: "idle" });

    const wrapper = mount(ModelPanel, { props: { hasActiveTasks: false } });
    await flushPromises();

    // 点击下载
    const downloadBtn = wrapper.find('.action-btn');
    expect(downloadBtn.text()).toContain("下载");
    
    vi.mocked(api.startModelDownload).mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await downloadBtn.trigger('click');

    // Should immediately show downloading state
    expect(wrapper.find('.action-btn').text()).toContain("下载请求中");

    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
  });
});
