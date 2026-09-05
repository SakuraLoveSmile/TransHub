import type { SubtitleTask } from "./types";

/**
 * 组件测试共用的任务数据构造。字段与后端 /api/subtitle-tasks 响应一致，
 * 默认返回一条已成功、带结果与下载地址的任务。
 */
export function makeTask(overrides: Partial<SubtitleTask> = {}): SubtitleTask {
  const id = overrides.id ?? "c7ed85f00509488ba1bbca94705a5105";
  return {
    id,
    mode: "transcribe",
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
      srt: `/api/subtitle-tasks/${id}/file?format=srt`,
      lrc: `/api/subtitle-tasks/${id}/file?format=lrc`,
    },
    error: null,
    ...overrides,
  };
}

/** 用十六进制序号生成合法长度的任务编号。 */
export function taskId(index: number): string {
  return index.toString(16).padStart(32, "0");
}
