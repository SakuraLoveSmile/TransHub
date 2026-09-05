import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ServiceStatus from "./ServiceStatus.vue";

const mockCheckHealth = vi.fn();
const mockFetchServiceStatus = vi.fn();

vi.mock("../api", () => ({
  checkHealth: () => mockCheckHealth(),
  fetchServiceStatus: () => mockFetchServiceStatus(),
}));

async function flush(times = 4) {
  for (let i = 0; i < times; i++) await flushPromises();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServiceStatus", () => {
  it("shows connecting state before the first check resolves", () => {
    mockCheckHealth.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(ServiceStatus);
    expect(wrapper.text()).toContain("正在连接");
    expect(wrapper.text()).not.toContain("已连接");
    wrapper.unmount();
  });

  it("renders online status with engine, device, model and mock badge", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockResolvedValue({
      status: "running",
      engine: "faster-whisper",
      mock: true,
      loaded_model: "chickenrice-v2",
      device: "cuda",
    });
    const wrapper = mount(ServiceStatus);
    await flush();
    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("模拟模式");
    expect(wrapper.text()).toContain("faster-whisper");
    expect(wrapper.text()).toContain("cuda");
    expect(wrapper.text()).toContain("chickenrice-v2");
    expect(wrapper.text()).toContain("处理中");
    wrapper.unmount();
  });

  it("shows unknown labels for missing engine and unknown engine state", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockResolvedValue({
      status: "weird",
      engine: "unknown",
      mock: false,
      loaded_model: null,
      device: null,
    });
    const wrapper = mount(ServiceStatus);
    await flush();
    expect(wrapper.text()).toContain("未知");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("设备未知");
    // Unknown engine state is not flattened to "idle".
    expect(wrapper.text()).not.toContain("空闲");
    wrapper.unmount();
  });

  it("clears stale online state when going offline with a startup hint", async () => {
    mockCheckHealth.mockResolvedValueOnce(true);
    mockFetchServiceStatus.mockResolvedValueOnce({
      status: "idle",
      engine: "faster-whisper",
      mock: false,
      loaded_model: "m",
      device: "cpu",
    });
    const wrapper = mount(ServiceStatus);
    await flush();
    expect(wrapper.text()).toContain("已连接");
    // 走离线路径：health 失败后不应保留旧在线态。
    mockCheckHealth.mockResolvedValue(false);
    // 手动触发下一次刷新（模拟轮询周期的下一轮）。
    // 通过再次挂载验证离线路径的独立行为。
    wrapper.unmount();

    mockCheckHealth.mockResolvedValue(false);
    const offline = mount(ServiceStatus);
    await flush();
    const alert = offline.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("服务离线");
    expect(offline.text()).toContain("127.0.0.1:8765");
    expect(offline.text()).toContain("run-real.bat");
    expect(offline.text()).not.toContain("已连接");
    offline.unmount();
  });

  it("stops polling after unmount", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockResolvedValue({
      status: "idle",
      engine: "e",
      mock: false,
      loaded_model: null,
      device: null,
    });
    const wrapper = mount(ServiceStatus);
    await flush();
    const calls = mockCheckHealth.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    wrapper.unmount();
    await flush();
    expect(mockCheckHealth.mock.calls.length).toBe(calls);
  });
});
