import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceStatus from "./ServiceStatus.vue";
import type { ServiceStatus as ServiceStatusInfo } from "../types";

vi.mock("../api", () => ({
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
}));

import { checkHealth, fetchServiceStatus } from "../api";

const mockedCheckHealth = vi.mocked(checkHealth);
const mockedFetchServiceStatus = vi.mocked(fetchServiceStatus);

const onlineStatus: ServiceStatusInfo = {
  status: "idle",
  engine: "faster-whisper",
  mock: false,
  loaded_model: "whisper-ja-1.5b",
  device: "cuda",
};

describe("ServiceStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedCheckHealth.mockResolvedValue(true);
    mockedFetchServiceStatus.mockResolvedValue(onlineStatus);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts connecting and only shows online details after both requests finish", async () => {
    let resolveHealth!: (value: boolean) => void;
    mockedCheckHealth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHealth = resolve;
      }),
    );
    const wrapper = mount(ServiceStatus);

    expect(wrapper.text()).toContain("正在连接");
    expect(wrapper.text()).not.toContain("已连接");

    resolveHealth(true);
    await flushPromises();
    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("cuda");
    expect(wrapper.text()).toContain("whisper-ja-1.5b");
    expect(wrapper.text()).toContain("空闲");
    wrapper.unmount();
  });

  it("clears stale status when the service goes offline", async () => {
    const wrapper = mount(ServiceStatus);
    await flushPromises();
    expect(wrapper.text()).toContain("已连接");

    mockedCheckHealth.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(wrapper.text()).toContain("服务离线");
    expect(wrapper.text()).toContain("请先启动 TransHub");
    expect(wrapper.text()).not.toContain("whisper-ja-1.5b");
    wrapper.unmount();
  });

  it("labels an unknown engine state as unknown", async () => {
    mockedFetchServiceStatus.mockResolvedValueOnce({
      ...onlineStatus,
      status: "maintenance",
    });
    const wrapper = mount(ServiceStatus);
    await flushPromises();
    expect(wrapper.text()).toContain("未知");
    expect(wrapper.text()).not.toContain("空闲");
    wrapper.unmount();
  });

  it("does not overlap status polling and does not update after unmount", async () => {
    let resolveHealth!: (value: boolean) => void;
    mockedCheckHealth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHealth = resolve;
      }),
    );
    const wrapper = mount(ServiceStatus);
    await vi.advanceTimersByTimeAsync(20000);
    expect(mockedCheckHealth).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    resolveHealth(true);
    await flushPromises();
    expect(mockedFetchServiceStatus).not.toHaveBeenCalled();
  });
});
