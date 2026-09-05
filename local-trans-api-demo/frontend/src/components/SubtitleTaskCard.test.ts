import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import type { SubtitleTask } from "../types";

function task(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "succeeded",
    stage: "completed",
    original_name: "speech.wav",
    mock: false,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: null,
    expires_at: null,
    result: {
      model: "chickenrice-v2",
      text: "こんにちは。\nお元気ですか。",
      duration: 12.5,
      processing_time: 3.2,
    },
    downloads: {
      srt: "/api/subtitle-tasks/c7ed85f00509488ba1bbca94705a5105/file?format=srt",
      lrc: "/api/subtitle-tasks/c7ed85f00509488ba1bbca94705a5105/file?format=lrc",
    },
    error: null,
    ...overrides,
  };
}

let clipboardMock: { writeText: ReturnType<typeof vi.fn> } | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // 清理全局 navigator.clipboard 以备下个测试。
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

function stubClipboard(
  impl?: (text: string) => Promise<void>,
): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  clipboardMock = { writeText };
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return clipboardMock;
}

describe("SubtitleTaskCard", () => {
  it("renders filename, mode, stage, mock badge and local time", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: task({ mock: true }) },
    });
    expect(wrapper.text()).toContain("speech.wav");
    expect(wrapper.text()).toContain("日语转录");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).toContain("模拟");
    expect(wrapper.text()).toContain("本地时间");
    wrapper.unmount();
  });

  it("shows stage labels for queued/running stages", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: task({ status: "running", stage: "processing" }) },
    });
    expect(wrapper.text()).toContain("处理音频");
    wrapper.unmount();
  });

  it("shows error code and detail without downloads for failed tasks", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: task({
          status: "failed",
          stage: "failed",
          result: null,
          downloads: null,
          error: { code: "INFERENCE_FAILED", detail: "推理崩溃" },
        }),
      },
    });
    expect(wrapper.text()).toContain("INFERENCE_FAILED");
    expect(wrapper.text()).toContain("推理崩溃");
    expect(wrapper.text()).not.toContain("下载 SRT");
    wrapper.unmount();
  });

  it("shows empty-result hint with disabled copy and no downloads", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: task({
          result: { model: "m", text: "", duration: 0, processing_time: 0 },
          downloads: null,
        }),
      },
    });
    expect(wrapper.text()).toContain("未识别到语音");
    const copy = wrapper.findAll("button").find((b) => b.text().includes("复制文本"))!;
    expect(copy.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).not.toContain("下载 SRT");
    wrapper.unmount();
  });

  it("shows duration and processing time from the result", () => {
    const wrapper = mount(SubtitleTaskCard, { props: { task: task() } });
    expect(wrapper.text()).toContain("音频时长 12.5s");
    expect(wrapper.text()).toContain("耗时 3.2s");
    wrapper.unmount();
  });

  it("collapses long text to six lines and expands on demand", async () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: task() },
    });
    const textBlock = wrapper.find(".result-text");
    expect(textBlock.classes()).toContain("collapsed");
    const toggle = wrapper.findAll("button").find((b) => b.text().includes("展开全文"))!;
    await toggle.trigger("click");
    expect(wrapper.find(".result-text").classes()).not.toContain("collapsed");
    expect(wrapper.text()).toContain("收起");
    wrapper.unmount();
  });

  it("shows download links for succeeded tasks", () => {
    const wrapper = mount(SubtitleTaskCard, { props: { task: task() } });
    const links = wrapper.findAll("a");
    const texts = links.map((link) => link.text());
    expect(texts).toContain("下载 SRT");
    expect(texts).toContain("下载 LRC");
    wrapper.unmount();
  });

  it("copies text to clipboard on success with role=status feedback", async () => {
    stubClipboard();
    const wrapper = mount(SubtitleTaskCard, { props: { task: task() } });
    const copy = wrapper.findAll("button").find((b) => b.text().includes("复制文本"))!;
    await copy.trigger("click");
    await flushPromises();
    expect(clipboardMock!.writeText).toHaveBeenCalledWith("こんにちは。\nお元気ですか。");
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("已复制");
    wrapper.unmount();
  });

  it("reports copy failure via role=status while preserving feedback", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const wrapper = mount(SubtitleTaskCard, { props: { task: task() } });
    const copy = wrapper.findAll("button").find((b) => b.text().includes("复制文本"))!;
    await copy.trigger("click");
    await flushPromises();
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("复制失败");
    wrapper.unmount();
  });

  it("falls back to manual selection guidance when clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const wrapper = mount(SubtitleTaskCard, { props: { task: task() } });
    const copy = wrapper.findAll("button").find((b) => b.text().includes("复制文本"))!;
    await copy.trigger("click");
    await flushPromises();
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("不支持复制");
    wrapper.unmount();
  });

  it("uses em dash for missing or invalid created_at", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: task({ created_at: "" }) },
    });
    expect(wrapper.text()).toContain("—");
    wrapper.unmount();
  });
});
