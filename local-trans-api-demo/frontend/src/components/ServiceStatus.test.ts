import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceStatus from "./ServiceStatus.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    checkHealth: vi.fn(),
    fetchServiceStatus: vi.fn(),
  };
});

const api = await import("../api");

const checkHealth = vi.mocked(api.checkHealth);
const fetchServiceStatus = vi.mocked(api.fetchServiceStatus);

beforeEach(() => {
  vi.useFakeTimers();
  checkHealth.mockReset();
  fetchServiceStatus.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("ServiceStatus", () => {
  it("请求完成前显示正在连接", () => {
    checkHealth.mockImplementation(() => new Promise(() => undefined));
    const wrapper = mount(ServiceStatus);

    expect(wrapper.text()).toContain("正在连接");
    expect(wrapper.text()).not.toContain("已连接");
    wrapper.unmount();
  });

  it("在线时展示模式、设备、当前模型与引擎状态", async () => {
    checkHealth.mockResolvedValue(true);
    fetchServiceStatus.mockResolvedValue({
      status: "idle",
      engine: "chickenrice",
      mock: false,
      loaded_model: "ja-asr-v1",
      device: "CUDA",
    });

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("设备 CUDA");
    expect(wrapper.text()).toContain("当前模型 ja-asr-v1");
    expect(wrapper.text()).toContain("引擎空闲");
    wrapper.unmount();
  });

  it("未知引擎状态显示未知而不是空闲", async () => {
    checkHealth.mockResolvedValue(true);
    fetchServiceStatus.mockResolvedValue({
      status: "booting",
      engine: "chickenrice",
      mock: true,
      loaded_model: null,
      device: null,
    });

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("引擎未知");
    expect(wrapper.text()).toContain("模拟模式（Mock）");
    wrapper.unmount();
  });

  it("离线时提示启动服务，恢复后重新显示在线", async () => {
    checkHealth.mockResolvedValueOnce(false);
    fetchServiceStatus.mockResolvedValue({
      status: "idle",
      engine: "chickenrice",
      mock: true,
      loaded_model: null,
      device: "CPU",
    });

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("已离线");
    expect(wrapper.text()).toContain("健康检查失败，服务未响应。");
    expect(wrapper.text()).toContain("127.0.0.1:8765");

    checkHealth.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).not.toContain("已离线");
    wrapper.unmount();
  });

  it("卸载后不再请求状态", async () => {
    checkHealth.mockResolvedValue(true);
    fetchServiceStatus.mockResolvedValue({
      status: "idle",
      engine: "chickenrice",
      mock: true,
      loaded_model: null,
      device: null,
    });

    const wrapper = mount(ServiceStatus);
    await flushPromises();
    const callsBeforeUnmount = checkHealth.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30000);

    expect(checkHealth.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
