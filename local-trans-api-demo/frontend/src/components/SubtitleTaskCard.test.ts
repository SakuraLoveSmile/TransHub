import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubtitleTask } from "../types";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "succeeded",
    stage: "completed",
    original_name: "sample.wav",
    mock: false,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: "2026-09-05T08:00:42Z",
    expires_at: null,
    result: {
      model: "whisper-ja-1.5b",
      text: "こんにちは世界。",
      duration: 15.2,
      processing_time: 3.4,
    },
    downloads: {
      srt: "/api/subtitle-tasks/x/file?format=srt",
      lrc: "/api/subtitle-tasks/x/file?format=lrc",
    },
    error: null,
    ...overrides,
  };
}

function mockClipboard(writeText: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  mockClipboard(undefined);
});

describe("SubtitleTaskCard", () => {
  it("renders name, mode, status, stage and mock badge", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ mock: true, mode: "translate" }) },
    });
    const text = wrapper.text();
    expect(text).toContain("sample.wav");
    expect(text).toContain("日语翻译成中文");
    expect(text).toContain("已完成");
    expect(text).toContain("当前阶段：已完成");
    expect(text).toContain("模拟");
    expect(text).toContain("（本地时间）");
  });

  it("shows duration and processing time for succeeded results", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });
    expect(wrapper.text()).toContain("音频时长 15.2 秒");
    expect(wrapper.text()).toContain("处理耗时 3.4 秒");
  });

  it("renders download links with correct hrefs", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });
    const links = wrapper.findAll("a[download]");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toContain("format=srt");
    expect(links[1].attributes("href")).toContain("format=lrc");
  });

  it("clamps long text and expands on toggle", async () => {
    const longText = Array.from({ length: 8 }, (_, i) => `第${i + 1}行字幕`).join(
      "\n",
    );
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ result: { ...makeTask().result!, text: longText } }) },
    });

    const textEl = wrapper.find(".task-card__text");
    expect(textEl.classes()).toContain("task-card__text--clamped");

    const toggle = wrapper.findAll("button").find((b) => b.text() === "展开全文");
    expect(toggle).toBeTruthy();
    await toggle!.trigger("click");

    expect(wrapper.find(".task-card__text").classes()).not.toContain(
      "task-card__text--clamped",
    );
    expect(wrapper.text()).toContain("收起");
    expect(wrapper.text()).toContain("第8行字幕");
  });

  it("copies text successfully and reports via role=status", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const copyBtn = wrapper.findAll("button").find((b) => b.text() === "复制文本");
    await copyBtn!.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("こんにちは世界。");
    const status = wrapper.find('[role="status"]');
    expect(status.exists()).toBe(true);
    expect(status.text()).toContain("已复制");
  });

  it("reports failure when clipboard write rejects", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const copyBtn = wrapper.findAll("button").find((b) => b.text() === "复制文本");
    await copyBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toContain("复制失败");
  });

  it("explains when clipboard is unavailable", async () => {
    mockClipboard(undefined);
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const copyBtn = wrapper.findAll("button").find((b) => b.text() === "复制文本");
    await copyBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toContain(
      "当前浏览器不支持复制",
    );
  });

  it("disables copy and explains empty result", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          result: { model: "m", text: "", duration: 1, processing_time: 1 },
          downloads: null,
        }),
      },
    });
    expect(wrapper.text()).toContain("未识别到语音（空结果）");
    const copyBtn = wrapper.findAll("button").find((b) => b.text() === "复制文本");
    expect(copyBtn).toBeFalsy();
  });

  it("renders error code and detail with role=alert", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "failed",
          stage: "failed",
          result: null,
          downloads: null,
          error: { code: "engine_error", detail: "推理失败" },
        }),
      },
    });
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("engine_error：推理失败");
    expect(wrapper.text()).toContain("失败");
  });

  it("shows stage text for running tasks", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "running",
          stage: "writing_output",
          result: null,
          downloads: null,
        }),
      },
    });
    expect(wrapper.text()).toContain("处理中");
    expect(wrapper.text()).toContain("当前阶段：写入字幕");
  });

  it("falls back to an em dash for invalid timestamps", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ created_at: "" }) },
    });
    expect(wrapper.text()).toContain("—（本地时间）");
  });
});
