import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import { makeTask } from "../testFixtures";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setClipboard(undefined);
});

describe("SubtitleTaskCard", () => {
  it("按状态展示排队、运行、完成与失败阶段", () => {
    const queued = mount(SubtitleTaskCard, {
      props: { task: makeTask({ status: "queued", stage: "queued", result: null, downloads: null }) },
    });
    expect(queued.text()).toContain("状态 排队中");
    expect(queued.text()).toContain("当前阶段：排队中");

    const running = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "running",
          stage: "processing",
          result: null,
          downloads: null,
        }),
      },
    });
    expect(running.text()).toContain("状态 处理中");
    expect(running.text()).toContain("当前阶段：处理音频");

    const succeeded = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    expect(succeeded.text()).toContain("状态 已完成");
    expect(succeeded.text()).toContain("当前阶段：已完成");

    const failed = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "failed",
          stage: "failed",
          result: null,
          downloads: null,
          error: { code: "INFERENCE_FAILED", detail: "推理失败：显存不足。" },
        }),
      },
    });
    expect(failed.text()).toContain("状态 失败");
    expect(failed.get('[role="alert"]').text()).toContain("INFERENCE_FAILED");
    expect(failed.get('[role="alert"]').text()).toContain("推理失败：显存不足。");
  });

  it("展示成功任务的音频时长与处理耗时", () => {
    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    expect(wrapper.text()).toContain("音频时长 15.2 秒");
    expect(wrapper.text()).toContain("处理耗时 3.4 秒");
  });

  it("空结果时禁用复制并说明未识别到语音", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          result: { model: "m", text: "", duration: 3, processing_time: 1 },
          downloads: null,
        }),
      },
    });

    expect(wrapper.text()).toContain("未识别到语音");
    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本");
    expect(copyButton?.attributes("disabled")).toBeDefined();
  });

  it("展示接口返回的 Mock 标记", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ mock: true }) },
    });
    expect(wrapper.text()).toContain("模拟结果");
  });

  it("成功任务提供 SRT 与 LRC 下载地址", () => {
    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    const links = wrapper.findAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toContain("format=srt");
    expect(links[1].attributes("href")).toContain("format=lrc");
  });

  it("默认只显示六行，展开后显示全文", async () => {
    const text = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n");
    const wrapper = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          result: { model: "m", text, duration: 1, processing_time: 1 },
        }),
      },
    });

    expect(wrapper.get(".preview").text()).toBe(
      "line-1\nline-2\nline-3\nline-4\nline-5\nline-6",
    );

    const toggle = wrapper.get("button");
    expect(toggle.text()).toBe("展开全文（还有 4 行）");
    await toggle.trigger("click");
    expect(wrapper.get(".preview").text()).toContain("line-10");
    expect(wrapper.get("button").text()).toBe("收起");
  });

  it("复制成功时给出已复制反馈", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本");
    await copyButton!.trigger("click");

    expect(writeText).toHaveBeenCalledWith("你好。");
    expect(wrapper.get('[role="status"]').text()).toBe("已复制");
  });

  it("复制失败时提示手动选择", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });

    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本");
    await copyButton!.trigger("click");
    await Promise.resolve();

    expect(wrapper.get('[role="status"]').text()).toBe(
      "复制失败，请展开后手动选择文本。",
    );
  });

  it("剪贴板不可用时提示手动选择", async () => {
    setClipboard(undefined);

    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    const copyButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "复制文本");
    await copyButton!.trigger("click");

    expect(wrapper.get('[role="status"]').text()).toBe(
      "当前浏览器不支持复制，请展开后手动选择文本。",
    );
  });

  it("缺失或非法时间显示为破折号", () => {
    const missing = mount(SubtitleTaskCard, {
      props: { task: makeTask({ created_at: "" }) },
    });
    expect(missing.text()).toContain("创建时间 —");

    const invalid = mount(SubtitleTaskCard, {
      props: { task: makeTask({ created_at: "not-a-date" }) },
    });
    expect(invalid.text()).toContain("创建时间 —");

    const valid = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    expect(valid.text()).toMatch(/创建时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(valid.text()).toContain("本地时间");
  });
});
