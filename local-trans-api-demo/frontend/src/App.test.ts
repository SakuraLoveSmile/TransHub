import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkHealth,
  fetchDownloadProgress,
  fetchModels,
  fetchServiceStatus,
  fetchTaskList,
  submitSubtitle,
  type SubtitleTask,
  type TaskListResponse,
} from "./api";
import App from "./App.vue";
import MediaFilePicker from "./components/MediaFilePicker.vue";

vi.mock("./api", () => ({
  describeApiError: (error: unknown) =>
    error instanceof Error ? error.message : "请求失败，请检查服务。",
  checkHealth: vi.fn(),
  fetchServiceStatus: vi.fn(),
  fetchTaskList: vi.fn(),
  submitSubtitle: vi.fn(),
  fetchModels: vi.fn(),
  fetchDownloadProgress: vi.fn(),
  loadModel: vi.fn(),
  unloadModel: vi.fn(),
  startModelDownload: vi.fn(),
}));

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: `${"a".repeat(29)}001`,
    mode: "transcribe",
    status: "succeeded",
    stage: "completed",
    original_name: "older.wav",
    mock: false,
    created_at: "",
    finished_at: null,
    expires_at: null,
    result: { model: "m", text: "旧结果", duration: 1, processing_time: 1 },
    downloads: null,
    error: null,
    ...overrides,
  };
}

function makeList(
  tasks: SubtitleTask[],
  total = tasks.length,
  offset = 0,
): TaskListResponse {
  return { tasks, total, limit: 20, offset };
}

async function mountApp(list: TaskListResponse[]) {
  vi.mocked(checkHealth).mockResolvedValue(true);
  vi.mocked(fetchServiceStatus).mockResolvedValue({
    status: "running",
    engine: "whisper.cpp",
    mock: false,
    loaded_model: "sensevoice-small",
    device: "CUDA",
  });
  vi.mocked(fetchModels).mockResolvedValue([
    {
      id: "sensevoice-small",
      name: "SenseVoice Small",
      type: "asr",
      installed: true,
      loaded: false,
      mock: false,
    },
  ]);
  vi.mocked(fetchDownloadProgress).mockResolvedValue({ state: "idle" });
  vi.mocked(fetchTaskList).mockImplementation(
    async (limit = 20, offset = 0) => {
      const page = list.find((entry) => entry.offset === offset);
      return page ?? makeList([], 0, offset);
    },
  );

  const wrapper = mount(App);
  await vi.advanceTimersByTimeAsync(0);
  return wrapper;
}

function labelledSections(wrapper: Awaited<ReturnType<typeof mountApp>>) {
  return wrapper
    .findAll("section[aria-label]")
    .map((section) => section.attributes("aria-label"));
}

function buttonByText(
  wrapper: Awaited<ReturnType<typeof mountApp>>,
  label: string,
) {
  const button = wrapper
    .findAll("button")
    .find((item) => item.text() === label);
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(checkHealth).mockReset();
  vi.mocked(fetchServiceStatus).mockReset();
  vi.mocked(fetchModels).mockReset();
  vi.mocked(fetchDownloadProgress).mockReset();
  vi.mocked(fetchTaskList).mockReset();
  vi.mocked(submitSubtitle).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("App", () => {
  it("renders the workbench with the documented section order", async () => {
    const wrapper = await mountApp([makeList([])]);

    expect(wrapper.find("h1").text()).toBe("TransHub");
    expect(wrapper.text()).toContain("本地字幕工作台");
    expect(labelledSections(wrapper)).toEqual([
      "服务状态",
      "创建字幕",
      "任务记录",
      "模型管理",
    ]);
    expect(wrapper.find(".workspace").exists()).toBe(true);
    wrapper.unmount();
  });

  it("keeps model actions locked while viewing an older page of tasks", async () => {
    const wrapper = await mountApp([
      makeList([makeTask({ status: "running", stage: "processing" })], 25, 0),
      makeList([makeTask({ original_name: "historic.wav" })], 25, 20),
    ]);

    await buttonByText(wrapper, "下一页").trigger("click");
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain("historic.wav");
    expect(buttonByText(wrapper, "加载").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("任务会自动加载所需模型");
    wrapper.unmount();
  });

  it("allows model actions again once no task is active", async () => {
    const wrapper = await mountApp([makeList([makeTask()], 1, 0)]);

    expect(buttonByText(wrapper, "加载").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("submits a file chosen through the picker and renders its task card", async () => {
    const accepted = makeTask({
      id: "b".repeat(32),
      status: "queued",
      stage: "queued",
      original_name: "picked.wav",
      result: null,
    });
    vi.mocked(submitSubtitle).mockResolvedValue(accepted);
    const wrapper = await mountApp([makeList([], 0, 0)]);

    await wrapper
      .findComponent(MediaFilePicker)
      .vm.$emit("update:modelValue", new File([new Uint8Array(1024)], "picked.wav"));
    await wrapper.find("form").trigger("submit");
    await vi.advanceTimersByTimeAsync(0);

    expect(submitSubtitle).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("picked.wav");
    expect(wrapper.text()).toContain("排队中");
    wrapper.unmount();
  });
});
