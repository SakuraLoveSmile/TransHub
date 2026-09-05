import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkHealth, fetchServiceStatus } = vi.hoisted(() => ({
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
}));

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    checkHealth,
    fetchServiceStatus,
  };
});

import ServiceStatus from "./ServiceStatus.vue";

beforeEach(() => {
  checkHealth.mockResolvedValue(true);
  fetchServiceStatus.mockResolvedValue({
    status: "idle",
    engine: "faster-whisper",
    mock: false,
    loaded_model: null,
    device: "cuda",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ServiceStatus", () => {
  it("shows a connecting state before the first response", () => {
    checkHealth.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(ServiceStatus);

    expect(wrapper.text()).toContain("正在连接服务…");
    expect(wrapper.text()).not.toContain("已连接");
  });

  it("shows online details when healthy", async () => {
    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("cuda");
    expect(wrapper.text()).toContain("未加载");
    expect(wrapper.text()).toContain("空闲");
  });

  it("marks mock mode and unknown engine state", async () => {
    fetchServiceStatus.mockResolvedValue({
      status: "",
      engine: "mock",
      mock: true,
      loaded_model: "chickenrice-v2",
      device: "cpu",
    });

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("模拟（Mock）");
    expect(wrapper.text()).toContain("未知");
  });

  it("shows the offline hint when health check fails", async () => {
    checkHealth.mockResolvedValue(false);
    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("服务离线");
    expect(wrapper.text()).toContain("run-real.bat");
  });
});
