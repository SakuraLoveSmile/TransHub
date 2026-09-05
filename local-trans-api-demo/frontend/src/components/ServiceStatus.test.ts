import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceStatus as ServiceStatusModel } from "../api";

vi.mock("../api", () => ({
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
}));

import { checkHealth, fetchServiceStatus } from "../api";
import ServiceStatus from "./ServiceStatus.vue";

const mockedHealth = vi.mocked(checkHealth);
const mockedStatus = vi.mocked(fetchServiceStatus);

function onlineStatus(
  overrides: Partial<ServiceStatusModel> = {},
): ServiceStatusModel {
  return {
    status: "idle",
    engine: "faster-whisper",
    mock: false,
    loaded_model: "whisper-ja-1.5b",
    device: "cuda",
    ...overrides,
  };
}

beforeEach(() => {
  // 仅 fake setTimeout/clearTimeout，保留 setImmediate 让 flushPromises 正常解析。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mockedHealth.mockReset();
  mockedStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ServiceStatus", () => {
  it("shows connecting before the first request resolves", async () => {
    let resolveHealth: (ok: boolean) => void = () => {};
    mockedHealth.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHealth = resolve;
        }),
    );

    const wrapper = mount(ServiceStatus);
    expect(wrapper.text()).toContain("正在连接");
    expect(wrapper.text()).not.toContain("已连接");

    resolveHealth(true);
    mockedStatus.mockResolvedValue(onlineStatus());
    await flushPromises();
  });

  it("renders mode, device, model and engine state when online", async () => {
    mockedHealth.mockResolvedValue(true);
    mockedStatus.mockResolvedValue(onlineStatus());

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("已连接");
    expect(text).toContain("真实推理");
    expect(text).toContain("cuda");
    expect(text).toContain("whisper-ja-1.5b");
    expect(text).toContain("引擎状态：空闲");
  });

  it("labels a running engine as busy and a mock build accordingly", async () => {
    mockedHealth.mockResolvedValue(true);
    mockedStatus.mockResolvedValue(
      onlineStatus({ status: "running", mock: true, device: null }),
    );

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("模拟模式（Mock）");
    expect(wrapper.text()).toContain("引擎状态：处理中");
    expect(wrapper.text()).toContain("设备：—");
  });

  it("shows 未知 for an unrecognized engine state", async () => {
    mockedHealth.mockResolvedValue(true);
    mockedStatus.mockResolvedValue(onlineStatus({ status: "bogus" }));

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("引擎状态：未知");
  });

  it("shows offline guidance and clears stale status", async () => {
    mockedHealth.mockResolvedValue(false);

    const wrapper = mount(ServiceStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("离线");
    expect(wrapper.text()).not.toContain("已连接");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("run-real.bat");
  });

  it("recovers from offline to online via serial polling", async () => {
    mockedHealth.mockResolvedValueOnce(false).mockResolvedValue(true);
    mockedStatus.mockResolvedValue(onlineStatus());

    const wrapper = mount(ServiceStatus);
    await flushPromises();
    expect(wrapper.text()).toContain("离线");

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(wrapper.text()).toContain("已连接");
  });

  it("stops polling after unmount", async () => {
    mockedHealth.mockResolvedValue(true);
    mockedStatus.mockResolvedValue(onlineStatus());

    const wrapper = mount(ServiceStatus);
    await vi.advanceTimersByTimeAsync(0);
    const calls = mockedHealth.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockedHealth.mock.calls.length).toBe(calls);
  });
});
