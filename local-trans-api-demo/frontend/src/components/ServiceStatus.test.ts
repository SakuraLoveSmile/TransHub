import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkHealth, fetchServiceStatus } from "../api";
import type { ServiceStatus } from "../api";
import ServiceStatusPanel from "./ServiceStatus.vue";

vi.mock("../api", () => ({
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
}));

const mockCheckHealth = vi.mocked(checkHealth);
const mockFetchServiceStatus = vi.mocked(fetchServiceStatus);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function onlineStatus(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    status: "idle",
    engine: "faster-whisper",
    mock: false,
    loaded_model: "chickenrice-v2",
    device: "CUDA",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockCheckHealth.mockReset();
  mockFetchServiceStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ServiceStatus", () => {
  it("初始显示正在连接，请求完成前不显示已连接", async () => {
    const pending = deferred<boolean>();
    mockCheckHealth.mockReturnValue(pending.promise);

    const wrapper = mount(ServiceStatusPanel);
    expect(wrapper.text()).toContain("正在连接服务…");
    expect(wrapper.text()).not.toContain("已连接");

    pending.resolve(true);
    mockFetchServiceStatus.mockResolvedValue(onlineStatus());
    await flushPromises();
    expect(wrapper.text()).toContain("已连接");
    wrapper.unmount();
  });

  it("在线时展示模式、设备、当前模型与引擎状态", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockResolvedValue(onlineStatus());

    const wrapper = mount(ServiceStatusPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("真实推理");
    expect(wrapper.text()).toContain("CUDA");
    expect(wrapper.text()).toContain("chickenrice-v2");
    expect(wrapper.text()).toContain("空闲");
    wrapper.unmount();
  });

  it("Mock 模式与未加载模型的展示", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockResolvedValue(
      onlineStatus({ mock: true, loaded_model: null, device: null }),
    );

    const wrapper = mount(ServiceStatusPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("模拟模式（Mock）");
    expect(wrapper.text()).toContain("未加载");
    wrapper.unmount();
  });

  it("未知引擎状态显示未知而不是空闲", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockResolvedValue(onlineStatus({ status: "warming-up" }));

    const wrapper = mount(ServiceStatusPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("未知");
    expect(wrapper.text()).not.toContain("空闲");
    wrapper.unmount();
  });

  it("离线时给出启动提示，恢复后回到在线", async () => {
    mockCheckHealth.mockResolvedValueOnce(true);
    mockFetchServiceStatus.mockResolvedValueOnce(onlineStatus());

    const wrapper = mount(ServiceStatusPanel);
    await flushPromises();
    expect(wrapper.text()).toContain("已连接");

    // 下一次轮询健康检查失败：进入离线并清掉旧的在线详情
    mockCheckHealth.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(wrapper.text()).toContain("服务离线");
    expect(wrapper.find('[role="alert"]').text()).toContain("run-real.bat");
    expect(wrapper.text()).not.toContain("chickenrice-v2");

    // 服务恢复后自动回到在线
    mockCheckHealth.mockResolvedValueOnce(true);
    mockFetchServiceStatus.mockResolvedValueOnce(onlineStatus());
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(wrapper.text()).toContain("已连接");
    expect(wrapper.text()).toContain("chickenrice-v2");
    wrapper.unmount();
  });

  it("状态接口异常同样视为离线", async () => {
    mockCheckHealth.mockResolvedValue(true);
    mockFetchServiceStatus.mockRejectedValue(new Error("500"));

    const wrapper = mount(ServiceStatusPanel);
    await flushPromises();

    expect(wrapper.text()).toContain("服务离线");
    wrapper.unmount();
  });

  it("轮询串行不重叠，卸载后停止", async () => {
    const pending: Array<Deferred<boolean>> = [];
    mockCheckHealth.mockImplementation(() => {
      const d = deferred<boolean>();
      pending.push(d);
      return d.promise;
    });

    const wrapper = mount(ServiceStatusPanel);
    expect(mockCheckHealth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20000);
    expect(mockCheckHealth).toHaveBeenCalledTimes(1);

    pending[0].resolve(true);
    mockFetchServiceStatus.mockResolvedValue(onlineStatus());
    await flushPromises();

    await vi.advanceTimersByTimeAsync(5000);
    expect(mockCheckHealth).toHaveBeenCalledTimes(2);

    pending[1].resolve(true);
    await flushPromises();
    wrapper.unmount();

    await vi.advanceTimersByTimeAsync(20000);
    expect(mockCheckHealth).toHaveBeenCalledTimes(2);
  });
});
