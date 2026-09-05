import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import type { SubtitleTask } from "../types";

function baseTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "succeeded",
    stage: "completed",
    original_name: "speech.wav",
    mock: false,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: "2026-09-05T08:00:42Z",
    expires_at: "2026-09-12T08:00:42Z",
    result: {
      model: "chickenrice-v2",
      text: "こんにちは。",
      duration: 15.2,
      processing_time: 3.4,
    },
    downloads: {
      srt: "/api/subtitle-tasks/c7ed85f00509488ba1bbca94705a5105/file?format=srt",
      lrc: "/api/subtitle-tasks/c7ed85f00509488ba1bbca94705a5105/file?format=lrc",
    },
    error: null,
    ...overrides,
  };
}

function stubClipboard(writeImpl: (text: string) => Promise<void>) {
  const writeText = vi.fn(writeImpl);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("SubtitleTaskCard", () => {
  it("renders queued/running stages, mock badge, mode and local time", () => {
    const queued = mount(SubtitleTaskCard, {
      props: { task: baseTask({ status: "queued", stage: "queued" }) },
    });
    expect(queued.text()).toContain("排队中");
    expect(queued.text()).toContain("日语转录");
    queued.unmount();

    const running = mount(SubtitleTaskCard, {
      props: {
        task: baseTask({
          status: "running",
          stage: "processing",
          mode: "translate",
          mock: true,
          result: null,
          downloads: null,
        }),
      },
    });
    expect(running.text()).toContain("处理中");
    expect(running.text()).toContain("日译中");
    expect(running.text()).toContain("模拟");
    // Running without text renders neither result nor empty hint.
    expect(running.find(".result-text").exists()).toBe(false);
    running.unmount();
  });

  it("shows empty-result hint and no downloads for succeeded tasks without text", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: baseTask({
          result: { model: "m", text: "", duration: 1, processing_time: 1 },
          downloads: null,
        }),
      },
    });
    expect(wrapper.text()).toContain("未识别到语音");
    expect(wrapper.find(".downloads").exists()).toBe(false);
    // No copy action is offered when there is nothing to copy.
    expect(wrapper.text()).not.toContain("复制文本");
    wrapper.unmount();
  });

  it("renders timing and SRT/LRC downloads for succeeded tasks", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: baseTask() },
    });
    expect(wrapper.text()).toContain("音频时长 15.2s");
    expect(wrapper.text()).toContain("耗时 3.4s");
    const links = wrapper.findAll(".downloads a");
    expect(links).toHaveLength(2);
    expect(links[0].text()).toContain("SRT");
    expect(links[0].attributes("href")).toContain("format=srt");
    expect(links[1].attributes("href")).toContain("format=lrc");
    wrapper.unmount();
  });

  it("shows failed error code, detail and Chinese hint", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: baseTask({
          status: "failed",
          stage: "failed",
          result: null,
          downloads: null,
          error: { code: "QUEUE_FULL", detail: "队列已满" },
        }),
      },
    });
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("QUEUE_FULL");
    expect(alert.text()).toContain("队列已满");
    expect(alert.text()).toContain("队列已满，请稍后重试");
    expect(wrapper.text()).toContain("失败");
    expect(wrapper.find(".downloads").exists()).toBe(false);
    wrapper.unmount();
  });

  it("collapses long text by default and expands on toggle", async () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: baseTask() },
    });
    const text = wrapper.find(".result-text");
    expect(text.classes()).toContain("collapsed");
    await wrapper.findAll(".ghost-button")[0].trigger("click");
    expect(wrapper.find(".result-text").classes()).not.toContain("collapsed");
    expect(wrapper.findAll(".ghost-button")[0].text()).toContain("收起");
    wrapper.unmount();
  });

  it("copies text and reports success via role=status", async () => {
    const writeText = stubClipboard(async () => {});
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: baseTask() },
    });
    const copyBtn = wrapper
      .findAll(".ghost-button")
      .find((b) => b.text().includes("复制文本"))!;
    await copyBtn.trigger("click");
    expect(writeText).toHaveBeenCalledWith("こんにちは。");
    expect(wrapper.find('[role="status"]').text()).toContain("已复制");
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("reports copy failure when clipboard write rejects", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: baseTask() },
    });
    const copyBtn = wrapper
      .findAll(".ghost-button")
      .find((b) => b.text().includes("复制文本"))!;
    await copyBtn.trigger("click");
    expect(wrapper.find('[role="status"]').text()).toContain("复制失败");
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("falls back to manual-copy hint when clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: baseTask() },
    });
    const copyBtn = wrapper
      .findAll(".ghost-button")
      .find((b) => b.text().includes("复制文本"))!;
    await copyBtn.trigger("click");
    expect(wrapper.find('[role="status"]').text()).toContain("手动复制");
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("renders result as interpolation, never as raw HTML", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: baseTask({
          result: {
            model: "m",
            text: "<b>加粗</b><script>alert(1)</script>",
            duration: 1,
            processing_time: 1,
          },
        }),
      },
    });
    expect(wrapper.find(".result-text").text()).toContain("<b>加粗</b>");
    expect(wrapper.find(".result-text").find("b").exists()).toBe(false);
    expect(wrapper.find(".result-text").find("script").exists()).toBe(false);
    wrapper.unmount();
  });
});
