import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkHealth, fetchServiceStatus } from "../api";
import ServiceStatus from "./ServiceStatus.vue";

vi.mock("../api", () => ({
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
}));

const ONLINE = {
  status: "idle",
  engine: "whisper.cpp",
  mock: false,
  loaded_model: "sensevoice-small",
  device: "CUDA",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(checkHealth).mockReset();
  vi.mocked(fetchServiceStatus).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountSettled() {
  const wrapper = mount(ServiceStatus);
  await vi.advanceTimersByTimeAsync(0);
  return wrapper;
}

describe("ServiceStatus", () => {
  it("stays in connecting state until the first response settles", async () => {
    vi.mocked(checkHealth).mockReturnValue(new Promise(() => {}));

    const wrapper = mount(ServiceStatus);
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("正在连接");
    expect(wrapper.text()).not.toContain("已连接");
  });

  it("shows mode, device, engine and current model once online", async () => {
    vi.mocked(checkHealth).mockResolvedValue(true);
    vi.mocked(fetchServiceStatus).mockResolvedValue(ONLINE);

    const wrapper = await mountSettled();

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("设备：CUDA");
    expect(wrapper.text()).toContain("引擎：whisper.cpp");
    expect(wrapper.text()).toContain("引擎状态：空闲");
    expect(wrapper.text()).toContain("当前模型：sensevoice-small");
  });

  it("labels an unrecognised engine status as unknown rather than idle", async () => {
    vi.mocked(checkHealth).mockResolvedValue(true);
    vi.mocked(fetchServiceStatus).mockResolvedValue({
      ...ONLINE,
      status: "warming_up",
      engine: "unknown",
      device: null,
      loaded_model: null,
    });

    const wrapper = await mountSettled();

    expect(wrapper.text()).toContain("引擎状态：未知");
    expect(wrapper.text()).toContain("引擎：未知");
    expect(wrapper.text()).toContain("设备：未知");
    expect(wrapper.text()).toContain("当前模型：未加载");
  });

  it("drops stale online fields and explains how to start the service when offline", async () => {
    vi.mocked(checkHealth).mockResolvedValue(true);
    vi.mocked(fetchServiceStatus).mockResolvedValue(ONLINE);
    const wrapper = await mountSettled();
    expect(wrapper.text()).toContain("已连接");

    vi.mocked(checkHealth).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(5000);

    expect(wrapper.text()).toContain("离线");
    expect(wrapper.text()).not.toContain("sensevoice-small");
    expect(wrapper.text()).toContain("请启动 TransHub");
  });

  it("recovers to online after a failed poll", async () => {
    vi.mocked(checkHealth).mockResolvedValue(false);
    vi.mocked(fetchServiceStatus).mockResolvedValue(ONLINE);
    const wrapper = mount(ServiceStatus);
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.text()).toContain("离线");

    vi.mocked(checkHealth).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5000);

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("当前模型：sensevoice-small");
  });

  it("polls serially and stops polling after unmount", async () => {
    vi.mocked(checkHealth).mockResolvedValue(true);
    vi.mocked(fetchServiceStatus).mockResolvedValue(ONLINE);
    const wrapper = await mountSettled();
    expect(checkHealth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(checkHealth).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(checkHealth).toHaveBeenCalledTimes(2);
  });
});
