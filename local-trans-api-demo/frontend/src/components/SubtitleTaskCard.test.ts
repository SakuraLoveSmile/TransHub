import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import type { SubtitleTask } from "../api";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "c7ed85f00509488ba1bbca94705a5105",
    mode: "transcribe",
    status: "queued",
    stage: "queued",
    original_name: "sample.flac",
    mock: false,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: null,
    expires_at: null,
    result: null,
    downloads: null,
    error: null,
    ...overrides,
  };
}

function longText(): string {
  return Array.from({ length: 9 }, (_, index) => `第${index + 1}行字幕`).join(
    "\n",
  );
}

function mountCard(task: SubtitleTask) {
  return mount(SubtitleTaskCard, { props: { task } });
}

function installClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  installClipboard(undefined);
});

describe("SubtitleTaskCard", () => {
  it("shows queued state with stage text and no downloads", () => {
    const wrapper = mountCard(makeTask());

    expect(wrapper.text()).toContain("sample.flac");
    expect(wrapper.text()).toContain("日语转录");
    expect(wrapper.text()).toContain("排队中");
    expect(wrapper.text()).toContain("当前阶段：排队中");
    expect(wrapper.findAll("a").length).toBe(0);
    expect(wrapper.find(".badge-warning").text()).toBe("排队中");
  });

  it("maps running stages to readable text", () => {
    const wrapper = mountCard(
      makeTask({ status: "running", stage: "processing" }),
    );
    expect(wrapper.text()).toContain("处理中");
    expect(wrapper.text()).toContain("当前阶段：处理音频");
  });

  it("shows unknown raw stage when not in the mapping", () => {
    const wrapper = mountCard(makeTask({ status: "running", stage: "weird" }));
    expect(wrapper.text()).toContain("当前阶段：weird");
  });

  it("renders a mock badge for mock tasks", () => {
    const wrapper = mountCard(makeTask({ mock: true }));
    expect(wrapper.text()).toContain("模拟数据");
  });

  it("shows a succeeded task with meta, downloads and copy", () => {
    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: {
          model: "chickenrice-v2",
          text: "你好。\n早上好。",
          duration: 15.2,
          processing_time: 3.4,
        },
        downloads: {
          srt: "/api/subtitle-tasks/id/file?format=srt",
          lrc: "/api/subtitle-tasks/id/file?format=lrc",
        },
      }),
    );

    expect(wrapper.text()).toContain("音频时长 15.2 秒 · 处理耗时 3.4 秒");
    expect(wrapper.find(".subtitle-text").text()).toBe("你好。\n早上好。");
    const links = wrapper.findAll("a");
    expect(links.map((link) => link.text())).toEqual(["下载 SRT", "下载 LRC"]);
    expect(links[0].attributes("href")).toContain("format=srt");
    expect(wrapper.find("button").attributes("disabled")).toBeUndefined();
  });

  it("collapses long subtitles to six lines and expands on demand", async () => {
    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: {
          model: "m",
          text: longText(),
          duration: 1,
          processing_time: 1,
        },
      }),
    );

    const preview = wrapper.find(".subtitle-text");
    expect(preview.text()).not.toContain("第9行字幕");
    expect(preview.text()).toContain("第6行字幕");
    expect(preview.text()).toContain("…");

    const expandButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "展开全文");
    expect(expandButton).toBeDefined();
    await expandButton!.trigger("click");

    expect(wrapper.find(".subtitle-text").text()).toContain("第9行字幕");
    expect(
      wrapper.findAll("button").some((button) => button.text() === "收起全文"),
    ).toBe(true);
  });

  it("explains empty results and disables copying", () => {
    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: {
          model: "m",
          text: "",
          duration: 0,
          processing_time: 1,
        },
      }),
    );

    expect(wrapper.text()).toContain("未识别到语音（空结果）。");
    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本");
    expect(copyButton?.attributes("disabled")).toBeDefined();
  });

  it("shows error code and detail for failed tasks", () => {
    const wrapper = mountCard(
      makeTask({
        status: "failed",
        stage: "failed",
        error: { code: "engine_error", detail: "推理引擎崩溃" },
      }),
    );

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("engine_error");
    expect(alert.text()).toContain("推理引擎崩溃");
    expect(wrapper.findAll("a").length).toBe(0);
  });

  it("copies text to the clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ writeText });

    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: { model: "m", text: "复制我", duration: 1, processing_time: 1 },
      }),
    );

    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本")!;
    await copyButton.trigger("click");

    expect(writeText).toHaveBeenCalledWith("复制我");
    const status = wrapper.find('[role="status"]');
    expect(status.text()).toBe("已复制");
    expect(status.classes()).not.toContain("copy-status-error");
  });

  it("reports a copy failure when the clipboard rejects", async () => {
    installClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });

    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: { model: "m", text: "复制我", duration: 1, processing_time: 1 },
      }),
    );

    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本")!;
    await copyButton.trigger("click");

    const status = wrapper.find('[role="status"]');
    expect(status.text()).toContain("复制失败，请展开后手动选择文本。");
    expect(status.classes()).toContain("copy-status-error");
  });

  it("explains when the clipboard API is unavailable", async () => {
    installClipboard(undefined);

    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: { model: "m", text: "复制我", duration: 1, processing_time: 1 },
      }),
    );

    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本")!;
    await copyButton.trigger("click");

    expect(wrapper.find('[role="status"]').text()).toContain(
      "当前浏览器不支持复制，请展开后手动选择文本。",
    );
  });

  it("falls back to an em dash for missing or invalid times", () => {
    const wrapper = mountCard(makeTask({ created_at: "" }));
    expect(wrapper.text()).toContain("—（本地时间）");

    const invalid = mountCard(makeTask({ created_at: "not-a-date" }));
    expect(invalid.text()).toContain("—（本地时间）");
  });
});
