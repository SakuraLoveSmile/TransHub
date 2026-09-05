import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import ServiceStatus from "./ServiceStatus.vue";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    checkHealth: vi.fn(),
    fetchServiceStatus: vi.fn(),
  };
});

describe("ServiceStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("服务初始连接中、离线恢复", async () => {
    vi.mocked(api.checkHealth).mockResolvedValueOnce(false); // Initially offline

    const wrapper = mount(ServiceStatus);
    expect(wrapper.text()).toContain("正在连接...");

    await flushPromises();
    expect(wrapper.text()).toContain("服务离线");

    // Advance timer to trigger next refresh
    vi.mocked(api.checkHealth).mockResolvedValueOnce(true);
    vi.mocked(api.fetchServiceStatus).mockResolvedValueOnce({
      status: "idle", engine: "cuda", mock: false, loaded_model: "base", device: "cuda:0"
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("空闲");
  });
});
