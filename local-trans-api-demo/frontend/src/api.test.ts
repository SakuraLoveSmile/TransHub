import { describe, expect, it } from "vitest";
import { parseSubtitleTask } from "./api";

const base = {
  id: "c7ed85f00509488ba1bbca94705a5105",
  mode: "translate",
  status: "succeeded",
  stage: "completed",
  original_name: "sample.flac",
  mock: false,
  created_at: "2026-09-05T08:00:00Z",
  finished_at: "2026-09-05T08:00:42Z",
  expires_at: "2026-09-12T08:00:42Z",
  result: {
    model: "chickenrice-v2",
    text: "你好。",
    duration: 15.2,
    processing_time: 3.4,
  },
  downloads: {
    srt: "/api/subtitle-tasks/c7ed85f00509488ba1bbca94705a5105/file?format=srt",
    lrc: "/api/subtitle-tasks/c7ed85f00509488ba1bbca94705a5105/file?format=lrc",
  },
  error: null,
};

describe("parseSubtitleTask", () => {
  it("accepts a succeeded task", () => {
    const task = parseSubtitleTask(base);
    expect(task.id).toBe(base.id);
    expect(task.downloads?.lrc).toContain("format=lrc");
  });

  it("rejects bad ids and statuses", () => {
    expect(() => parseSubtitleTask({ ...base, id: "xyz" })).toThrow();
    expect(() => parseSubtitleTask({ ...base, status: "bogus" })).toThrow();
    expect(() => parseSubtitleTask({ ...base, mode: "nope" })).toThrow();
  });

  it("rejects malformed downloads and results", () => {
    expect(() =>
      parseSubtitleTask({ ...base, downloads: { srt: "", lrc: "" } }),
    ).toThrow();
    expect(() =>
      parseSubtitleTask({ ...base, result: { model: 1 } }),
    ).toThrow();
  });
});
