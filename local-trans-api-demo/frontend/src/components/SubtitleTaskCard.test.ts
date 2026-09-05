import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubtitleTask } from "../api";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "translate",
    status: "succeeded",
    stage: "completed",
    original_name: "sample.flac",
    mock: true,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: null,
    expires_at: null,
    result: {
      model: "chickenrice-v2",
      text: "第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行",
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

function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  stubClipboard(undefined);
  vi.restoreAllMocks();
});

describe("SubtitleTaskCard", () => {
  it("renders name, mode, mock badge and local time", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    expect(wrapper.text()).toContain("sample.flac");
    expect(wrapper.text()).toContain("日语翻译成中文");
    expect(wrapper.text()).toContain("模拟");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).toContain("本地时间");
    expect(wrapper.text()).toContain("音频时长 15.2 秒");
    expect(wrapper.text()).toContain("处理耗时 3.4 秒");
  });

  it("collapses long text and expands on demand", async () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const preview = wrapper.find(".subtitle-preview");
    expect(preview.classes()).toContain("collapsed");
    expect(wrapper.text()).toContain("展开全文");

    await wrapper.find('button[aria-expanded]').trigger("click");
    expect(wrapper.find(".subtitle-preview").classes()).not.toContain(
      "collapsed",
    );
  });

  it("copies text and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });

    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const buttons = wrapper.findAll("button");
    const copyButton = buttons.find((b) => b.text() === "复制文本");
    await copyButton?.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(makeTask().result?.text);
    expect(wrapper.find('[role="status"]').text()).toBe("已复制");
  });

  it("reports failure when clipboard write rejects", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("no")) });

    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const copyButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "复制文本");
    await copyButton?.trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toContain("复制失败");
  });

  it("explains when clipboard is unavailable", async () => {
    stubClipboard(undefined);

    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const copyButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "复制文本");
    await copyButton?.trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toContain(
      "当前浏览器不支持复制",
    );
  });

  it("shows download links for succeeded tasks", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask() },
    });

    const links = wrapper.findAll("a");
    expect(links.map((a) => a.text())).toEqual(["下载 SRT", "下载 LRC"]);
  });

  it("explains empty speech result without copy button", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          result: {
            model: "m",
            text: "",
            duration: 1,
            processing_time: 1,
          },
        }),
      },
    });

    expect(wrapper.text()).toContain("未识别到语音");
    expect(
      wrapper.findAll("button").find((b) => b.text() === "复制文本"),
    ).toBeUndefined();
  });

  it("shows error code and detail for failed tasks", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "failed",
          stage: "failed",
          result: null,
          downloads: null,
          error: { code: "transcription_failed", detail: "模型加载失败" },
        }),
      },
    });

    expect(wrapper.text()).toContain("transcription_failed");
    expect(wrapper.text()).toContain("模型加载失败");
  });

  it("shows stage text for running tasks", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "running",
          stage: "processing",
          result: null,
          downloads: null,
        }),
      },
    });

    expect(wrapper.text()).toContain("正在处理音频");
  });
});
