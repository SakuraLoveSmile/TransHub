import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SubtitleTaskCard from "./SubtitleTaskCard.vue";
import type { SubtitleTask } from "../types";

function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  return {
    id: "1234567890abcdef1234567890abcdef",
    mode: "translate",
    status: "succeeded",
    stage: "completed",
    original_name: "long-name.flac",
    mock: true,
    created_at: "2026-09-05T08:00:00Z",
    finished_at: "2026-09-05T08:00:03Z",
    expires_at: null,
    result: {
      model: "chickenrice-v2",
      text: "晚上好。\n今天请多关照。",
      duration: 125.4,
      processing_time: 3.4,
    },
    downloads: {
      srt: "/api/subtitle-tasks/123/file?format=srt",
      lrc: "/api/subtitle-tasks/123/file?format=lrc",
    },
    error: null,
    ...overrides,
  };
}

describe("SubtitleTaskCard", () => {
  it("renders result metadata, local time, Mock marker, and downloads", () => {
    const wrapper = mount(SubtitleTaskCard, { props: { task: makeTask() } });

    expect(wrapper.text()).toContain("long-name.flac");
    expect(wrapper.text()).toContain("日语翻译成中文");
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).toContain("Mock 环境");
    expect(wrapper.text()).toContain("本地时间");
    expect(wrapper.text()).toContain("音频时长 125.4 秒");
    expect(wrapper.text()).toContain("处理耗时 3.4 秒");
    expect(wrapper.find('a[download][href$="format=srt"]').exists()).toBe(true);
    expect(wrapper.find('a[download][href$="format=lrc"]').exists()).toBe(true);
  });

  it("expands a long subtitle and copies it with feedback", async () => {
    const text = Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 行`).join("\n");
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ result: { ...makeTask().result!, text } }) },
    });

    expect(wrapper.find(".subtitle-preview").classes()).toContain("is-collapsed");
    await wrapper.get(".expand-button").trigger("click");
    expect(wrapper.find(".subtitle-preview").classes()).not.toContain("is-collapsed");
    expect(wrapper.get(".expand-button").text()).toContain("收起全文");

    await wrapper.get('button:not(.expand-button)').trigger("click");
    expect(clipboard).toHaveBeenCalledWith(text);
    expect(wrapper.find('[role="status"]').text()).toContain("已复制");
  });

  it("reports clipboard failures and unsupported browsers", async () => {
    const failedClipboard = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: failedClipboard },
    });
    const failed = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    await failed.get('button:not(.expand-button)').trigger("click");
    expect(failed.find('[role="status"]').text()).toContain("复制失败");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const unsupported = mount(SubtitleTaskCard, { props: { task: makeTask() } });
    await unsupported.get('button:not(.expand-button)').trigger("click");
    expect(unsupported.find('[role="status"]').text()).toContain("不支持复制");
  });

  it("disables copy and explains empty results, and renders errors", () => {
    const empty = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          result: { ...makeTask().result!, text: "" },
        }),
      },
    });
    expect(empty.text()).toContain("未识别到语音");
    expect(empty.get('button:not(.expand-button)').attributes("disabled")).toBeDefined();

    const failed = mount(SubtitleTaskCard, {
      props: {
        task: makeTask({
          status: "failed",
          stage: "failed",
          result: null,
          downloads: null,
          error: { code: "SERVICE_RESTARTED", detail: "服务重启，任务未完成。" },
        }),
      },
    });
    expect(failed.text()).toContain("SERVICE_RESTARTED");
    expect(failed.text()).toContain("服务重启，任务未完成。");
    expect(failed.find('[download]').exists()).toBe(false);
  });

  it("uses an em dash for missing or invalid timestamps", () => {
    const wrapper = mount(SubtitleTaskCard, {
      props: { task: makeTask({ created_at: "not-a-date" }) },
    });
    expect(wrapper.text()).toContain("—");
  });
});
