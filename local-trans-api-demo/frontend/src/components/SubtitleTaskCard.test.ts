import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubtitleTask } from "../api";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "a".repeat(32),
    mode: "transcribe",
    status: "running",
    stage: "processing",
    original_name: "episode.wav",
    mock: false,
    created_at: "",
    finished_at: null,
    expires_at: null,
    result: null,
    downloads: null,
    error: null,
    ...overrides,
  };
}

function mountCard(task: SubtitleTask) {
  return mount(SubtitleTaskCard, { props: { task } });
}

function findButton(wrapper: ReturnType<typeof mountCard>, label: string) {
  const button = wrapper
    .findAll("button")
    .find((item) => item.text() === label);
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

function stubClipboard(value: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

const EIGHT_LINES = Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 行`).join("\n");

beforeEach(() => {
  stubClipboard(undefined);
});

describe("SubtitleTaskCard", () => {
  it("describes a queued task with stage text instead of colour alone", () => {
    const wrapper = mountCard(
      makeTask({ status: "queued", stage: "queued", original_name: "talk.mp3" }),
    );

    expect(wrapper.text()).toContain("talk.mp3");
    expect(wrapper.text()).toContain("排队中");
    expect(wrapper.text()).toContain("当前阶段：排队");
  });

  it("maps running stages to readable labels and shows the translate mode", () => {
    const wrapper = mountCard(
      makeTask({ mode: "translate", status: "running", stage: "writing_output" }),
    );

    expect(wrapper.text()).toContain("日语翻译成中文");
    expect(wrapper.text()).toContain("当前阶段：写入字幕");
    expect(wrapper.text()).toContain("处理中");
  });

  it("shows audio length and processing time for a succeeded task", () => {
    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: { model: "sensevoice", text: "こんにちは", duration: 12.5, processing_time: 3.25 },
      }),
    );

    expect(wrapper.text()).toContain("音频时长 12.5 秒");
    expect(wrapper.text()).toContain("处理耗时 3.3 秒");
    expect(wrapper.find(".subtitle").text()).toBe("こんにちは");
  });

  it("shows the mock flag returned by the API", () => {
    const wrapper = mountCard(makeTask({ mock: true }));
    expect(wrapper.text()).toContain("模拟（Mock）");
  });

  it("keeps long subtitles collapsed to six lines until expanded", async () => {
    const wrapper = mountCard(
      makeTask({ status: "succeeded", stage: "completed", result: { model: "m", text: EIGHT_LINES, duration: 1, processing_time: 1 } }),
    );

    const toggle = findButton(wrapper, "展开全文");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(".subtitle").text()).toBe(
      Array.from({ length: 6 }, (_, i) => `第 ${i + 1} 行`).join("\n"),
    );

    await toggle.trigger("click");
    expect(wrapper.find(".subtitle").text()).toBe(EIGHT_LINES);
    expect(findButton(wrapper, "收起").attributes("aria-expanded")).toBe("true");
  });

  it("hides the expand control when the subtitle fits in six lines", () => {
    const wrapper = mountCard(
      makeTask({ status: "succeeded", stage: "completed", result: { model: "m", text: "一行\n两行", duration: 1, processing_time: 1 } }),
    );

    expect(wrapper.text()).not.toContain("展开全文");
    expect(wrapper.find(".subtitle").text()).toBe("一行\n两行");
  });

  it("copies the full text and reports success through role=status", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const wrapper = mountCard(
      makeTask({ status: "succeeded", stage: "completed", result: { model: "m", text: "全文内容", duration: 1, processing_time: 1 } }),
    );

    await findButton(wrapper, "复制文本").trigger("click");
    await writeText.mock.results[0].value;

    expect(writeText).toHaveBeenCalledWith("全文内容");
    expect(wrapper.find('[role="status"]').text()).toBe("已复制");
  });

  it("reports a clipboard rejection instead of failing silently", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard({ writeText });
    const wrapper = mountCard(
      makeTask({ status: "succeeded", stage: "completed", result: { model: "m", text: "全文内容", duration: 1, processing_time: 1 } }),
    );

    await findButton(wrapper, "复制文本").trigger("click");
    await writeText.mock.results[0].value.catch(() => undefined);

    expect(wrapper.find('[role="status"]').text()).toBe(
      "复制失败，请展开后手动选择文本。",
    );
  });

  it("explains when the browser has no clipboard support", async () => {
    stubClipboard(undefined);
    const wrapper = mountCard(
      makeTask({ status: "succeeded", stage: "completed", result: { model: "m", text: "全文内容", duration: 1, processing_time: 1 } }),
    );

    await findButton(wrapper, "复制文本").trigger("click");

    expect(wrapper.find('[role="status"]').text()).toBe(
      "当前浏览器不支持复制，请展开后手动选择文本。",
    );
  });

  it("disables copying and explains an empty result", () => {
    const wrapper = mountCard(
      makeTask({ status: "succeeded", stage: "completed", result: { model: "m", text: "", duration: 4, processing_time: 1 } }),
    );

    expect(wrapper.text()).toContain("未识别到语音（空结果）。");
    expect(findButton(wrapper, "复制文本").attributes("disabled")).toBeDefined();
  });

  it("renders the SRT and LRC download links returned by the API", () => {
    const wrapper = mountCard(
      makeTask({
        status: "succeeded",
        stage: "completed",
        result: { model: "m", text: "文本", duration: 1, processing_time: 1 },
        downloads: { srt: "/api/subtitle-tasks/x/file?format=srt", lrc: "/api/subtitle-tasks/x/file?format=lrc" },
      }),
    );

    const links = wrapper.findAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toBe("/api/subtitle-tasks/x/file?format=srt");
    expect(links[0].attributes("download")).toBeDefined();
    expect(links[1].attributes("href")).toBe("/api/subtitle-tasks/x/file?format=lrc");
  });

  it("shows the error code and detail for a failed task", () => {
    const wrapper = mountCard(
      makeTask({
        status: "failed",
        stage: "failed",
        error: { code: "MODEL_NOT_INSTALLED", detail: "模型尚未安装。" },
      }),
    );

    expect(wrapper.text()).toContain("失败");
    expect(wrapper.find('[role="alert"]').text()).toContain("MODEL_NOT_INSTALLED");
    expect(wrapper.find('[role="alert"]').text()).toContain("模型尚未安装。");
  });

  it("formats created_at in the browser timezone and falls back to a dash", () => {
    const local = new Date(2026, 2, 5, 10, 30, 0);
    const wrapper = mountCard(makeTask({ created_at: local.toISOString() }));
    expect(wrapper.text()).toContain("创建时间 2026-03-05 10:30:00 本地时间");

    expect(mountCard(makeTask({ created_at: "" })).text()).toContain("创建时间 —");
    expect(mountCard(makeTask({ created_at: "not-a-date" })).text()).toContain("创建时间 —");
  });

  it("does not offer cancel, delete or rerun actions the API lacks", () => {
    const wrapper = mountCard(makeTask({ status: "running", stage: "processing" }));
    const labels = wrapper.findAll("button").map((item) => item.text());

    expect(labels.some((label) => /取消|删除|重新/.test(label))).toBe(false);
    expect(labels).toContain("复制文本");
  });
});
