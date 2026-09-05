import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServiceStatus from "./ServiceStatus.vue";
import { checkHealth, fetchServiceStatus } from "../api";

vi.mock("../api", () => ({
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
}));

const mockHealth = vi.mocked(checkHealth);
const mockStatus = vi.mocked(fetchServiceStatus);

const statusPayload = {
  status: "idle",
  engine: "faster-whisper",
  mock: false,
  loaded_model: "chickenrice-v2",
  device: "cuda",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ServiceStatus", () => {
  it("shows connecting before the first request resolves", () => {
    const wrapper = mount(ServiceStatus);
    expect(wrapper.text()).toContain("正在连接");
    expect(wrapper.text()).not.toContain("已连接");
    wrapper.unmount();
  });

  it("shows online details after health and status succeed", async () => {
    mockHealth.mockResolvedValue(true);
    mockStatus.mockResolvedValue(statusPayload);

    const wrapper = mount(ServiceStatus);
    await vi.waitFor(() => expect(wrapper.text()).toContain("已连接"));

    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("cuda");
    expect(wrapper.text()).toContain("chickenrice-v2");
    expect(wrapper.text()).toContain("空闲");
    expect(wrapper.find(".status-dot.online").exists()).toBe(true);
    wrapper.unmount();
  });

  it("labels unknown engine states as unknown instead of idle", async () => {
    mockHealth.mockResolvedValue(true);
    mockStatus.mockResolvedValue({ ...statusPayload, status: "something" });

    const wrapper = mount(ServiceStatus);
    await vi.waitFor(() => expect(wrapper.text()).toContain("已连接"));

    expect(wrapper.text()).toContain("未知");
    expect(wrapper.text()).not.toContain("空闲");
    wrapper.unmount();
  });

  it("marks mock mode explicitly", async () => {
    mockHealth.mockResolvedValue(true);
    mockStatus.mockResolvedValue({ ...statusPayload, mock: true });

    const wrapper = mount(ServiceStatus);
    await vi.waitFor(() => expect(wrapper.text()).toContain("已连接"));

    expect(wrapper.text()).toContain("模拟（Mock）");
    wrapper.unmount();
  });

  it("switches to offline without stale online data, then recovers", async () => {
    vi.useFakeTimers();
    try {
      mockHealth.mockResolvedValue(false);
      const wrapper = mount(ServiceStatus);
      await vi.advanceTimersByTimeAsync(0);

      expect(wrapper.text()).toContain("服务离线");
      expect(wrapper.text()).not.toContain("已连接");
      expect(wrapper.text()).not.toContain("chickenrice-v2");

      mockHealth.mockResolvedValue(true);
      mockStatus.mockResolvedValue(statusPayload);
      await vi.advanceTimersByTimeAsync(5000);

      expect(wrapper.text()).toContain("已连接");
      expect(wrapper.text()).toContain("chickenrice-v2");
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls serially and stops after unmount", async () => {
    vi.useFakeTimers();
    try {
      mockHealth.mockResolvedValue(true);
      mockStatus.mockResolvedValue(statusPayload);

      const wrapper = mount(ServiceStatus);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(15000);

      const callsAfterMounted = mockHealth.mock.calls.length;
      expect(callsAfterMounted).toBeGreaterThanOrEqual(2);

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(60000);
      expect(mockHealth.mock.calls.length).toBe(callsAfterMounted);
    } finally {
      vi.useRealTimers();
    }
  });
});
