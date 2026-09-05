import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubtitleTask } from "../api";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

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

function succeededTask(text: string): SubtitleTask {
  return makeTask({
    status: "succeeded",
    stage: "completed",
    result: { model: "chickenrice-v2", text, duration: 15.2, processing_time: 3.4 },
    downloads: { srt: "/api/x/file?format=srt", lrc: "/api/x/file?format=lrc" },
  });
}

function setClipboard(value: unknown) {
  Object.defineProperty(window.navigator, "clipboard", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  setClipboard(undefined);
});

describe("SubtitleTaskCard", () => {
  it("排队任务展示状态与当前阶段", () => {
    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    expect(wrapper.text()).toContain("排队中");
    expect(wrapper.text()).toContain("当前阶段：排队中");
    expect(wrapper.text()).toContain("本地时间");
  });

  it("处理中任务展示阶段文字与 Mock 标记", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({ status: "running", stage: "loading_model", mock: true }),
      },
    });
    expect(wrapper.text()).toContain("处理中");
    expect(wrapper.text()).toContain("当前阶段：加载模型");
    expect(wrapper.find(".badge-mock").text()).toBe("Mock");
  });

  it("未知阶段按原文展示", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ status: "running", stage: "demuxing" }) },
    });
    expect(wrapper.text()).toContain("当前阶段：demuxing");
  });

  it("成功任务展示时长、耗时与下载链接", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: succeededTask("こんにちは") },
    });
    expect(wrapper.text()).toContain("音频时长 15.2 秒");
    expect(wrapper.text()).toContain("处理耗时 3.4 秒");
    expect(wrapper.text()).toContain("chickenrice-v2");
    const links = wrapper.findAll("a[download]");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toContain("format=srt");
    expect(links[1].attributes("href")).toContain("format=lrc");
  });

  it("长文本默认折叠，点击展开全文后显示完整内容", async () => {
    const longText = Array.from({ length: 10 }, (_, i) => `第 ${i + 1} 行字幕`).join("\n");
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: succeededTask(longText) },
    });

    const preview = wrapper.find(".task-preview");
    expect(preview.classes()).toContain("is-clamped");
    const toggle = wrapper.findAll("button").find((b) => b.text() === "展开全文");
    expect(toggle).toBeTruthy();
    await toggle!.trigger("click");
    expect(wrapper.find(".task-preview").classes()).not.toContain("is-clamped");
    expect(wrapper.text()).toContain("第 10 行字幕");
    expect(
      wrapper.findAll("button").find((b) => b.text() === "收起"),
    ).toBeTruthy();
  });

  it("复制成功给出已复制反馈", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: succeededTask("你好世界") },
    });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "复制文本")!
      .trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith("你好世界");
    expect(wrapper.find('[role="status"]').text()).toBe("已复制");
  });

  it("复制失败提示手动选择", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: succeededTask("你好世界") },
    });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "复制文本")!
      .trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toBe(
      "复制失败，请展开后手动选择文本。",
    );
  });

  it("剪贴板不可用时说明原因", async () => {
    setClipboard(undefined);
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: succeededTask("你好世界") },
    });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "复制文本")!
      .trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').text()).toBe(
      "当前浏览器不支持复制，请展开后手动选择文本。",
    );
  });

  it("空结果禁用复制并说明未识别到语音", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: succeededTask("") },
    });
    expect(wrapper.text()).toContain("未识别到语音");
    const copyButton = wrapper
      .findAll("button")
      .find((b) => b.text().includes("复制文本"))!;
    expect(copyButton.attributes("disabled")).toBeDefined();
  });

  it("失败任务展示错误代码与说明", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "failed",
          stage: "failed",
          error: { code: "MODEL_NOT_INSTALLED", detail: "所需模型未安装。" },
        }),
      },
    });
    const alert = wrapper.find('[role="alert"]');
    expect(alert.text()).toContain("MODEL_NOT_INSTALLED");
    expect(alert.text()).toContain("所需模型未安装。");
    expect(wrapper.text()).toContain("失败");
  });

  it("缺失或无效创建时间显示占位符", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ created_at: "not-a-date" }) },
    });
    expect(wrapper.text()).toContain("创建时间：—");
  });
});
