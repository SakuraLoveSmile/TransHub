import type {
  DownloadProgress,
  ModelInfo,
  ServiceStatus,
  SubtitleMode,
  SubtitleTask,
  TaskListResponse,
} from "./types";

export type {
  DownloadProgress,
  ModelInfo,
  ServiceStatus,
  SubtitleMode,
  SubtitleTask,
  TaskListResponse,
};

const TASK_STATUSES = new Set(["queued", "running", "succeeded", "failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(status: number, body: unknown): string {
  if (
    isRecord(body) &&
    "detail" in body &&
    typeof body.detail === "string" &&
    body.detail
  ) {
    return body.detail;
  }
  if (
    isRecord(body) &&
    "code" in body &&
    "detail" in body &&
    typeof body.detail === "string"
  ) {
    return body.detail;
  }
  return `请求失败（HTTP ${status}）`;
}

async function readError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  if (
    isRecord(body) &&
    "detail" in body &&
    typeof body.detail === "string" &&
    body.detail
  ) {
    return new Error(body.detail);
  }
  return new Error(`请求失败（HTTP ${response.status}）`);
}

export function parseSubtitleTask(value: unknown): SubtitleTask {
  if (!isRecord(value)) throw new Error("任务响应格式非法。");
  const { id, mode, status, stage, original_name, mock } = value;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) {
    throw new Error("任务响应缺少合法编号。");
  }
  if (mode !== "transcribe" && mode !== "translate") {
    throw new Error("任务响应模式非法。");
  }
  if (typeof status !== "string" || !TASK_STATUSES.has(status)) {
    throw new Error("任务响应状态非法。");
  }
  if (typeof stage !== "string" || !stage) {
    throw new Error("任务响应阶段非法。");
  }
  if (typeof original_name !== "string" || !original_name) {
    throw new Error("任务响应缺少文件名。");
  }
  if (typeof mock !== "boolean") {
    throw new Error("任务响应缺少模拟标记。");
  }
  let result: SubtitleTask["result"] = null;
  if (value.result !== null && value.result !== undefined) {
    if (!isRecord(value.result)) throw new Error("任务结果格式非法。");
    const { model, text, duration, processing_time } = value.result;
    if (
      typeof model !== "string" ||
      typeof text !== "string" ||
      typeof duration !== "number" ||
      typeof processing_time !== "number"
    ) {
      throw new Error("任务结果字段非法。");
    }
    result = { model, text, duration, processing_time };
  }
  let downloads: SubtitleTask["downloads"] = null;
  if (value.downloads !== null && value.downloads !== undefined) {
    if (!isRecord(value.downloads)) throw new Error("任务下载地址非法。");
    const { srt, lrc } = value.downloads;
    if (typeof srt !== "string" || typeof lrc !== "string" || !srt || !lrc) {
      throw new Error("任务下载地址非法。");
    }
    downloads = { srt, lrc };
  }
  let error: SubtitleTask["error"] = null;
  if (value.error !== null && value.error !== undefined) {
    if (!isRecord(value.error)) throw new Error("任务错误格式非法。");
    if (
      typeof value.error.code !== "string" ||
      typeof value.error.detail !== "string"
    ) {
      throw new Error("任务错误格式非法。");
    }
    error = { code: value.error.code, detail: value.error.detail };
  }
  return {
    id,
    mode,
    status: status as SubtitleTask["status"],
    stage,
    original_name,
    mock,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    finished_at:
      typeof value.finished_at === "string" ? value.finished_at : null,
    expires_at:
      typeof value.expires_at === "string" ? value.expires_at : null,
    result,
    downloads,
    error,
  };
}

export async function submitSubtitle(
  file: File,
  mode: SubtitleMode,
): Promise<SubtitleTask> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  const response = await fetch("/api/subtitle-tasks", {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw await readError(response);
  return parseSubtitleTask(await response.json());
}

export async function fetchTaskList(
  limit = 20,
  offset = 0,
): Promise<TaskListResponse> {
  const response = await fetch(
    `/api/subtitle-tasks?limit=${limit}&offset=${offset}`,
  );
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.tasks)) {
    throw new Error("任务列表格式非法。");
  }
  return {
    tasks: (body.tasks as unknown[]).map(parseSubtitleTask),
    total: typeof body.total === "number" ? body.total : 0,
    limit: typeof body.limit === "number" ? body.limit : limit,
    offset: typeof body.offset === "number" ? body.offset : offset,
  };
}

export async function fetchTask(id: string): Promise<SubtitleTask> {
  const response = await fetch(
    `/api/subtitle-tasks/${encodeURIComponent(id)}`,
  );
  if (!response.ok) throw await readError(response);
  return parseSubtitleTask(await response.json());
}

export async function fetchServiceStatus(): Promise<ServiceStatus> {
  const response = await fetch("/api/status");
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("服务状态格式非法。");
  return {
    status: typeof body.status === "string" ? body.status : "unknown",
    engine: typeof body.engine === "string" ? body.engine : "unknown",
    mock: body.mock === true,
    loaded_model:
      typeof body.loaded_model === "string" ? body.loaded_model : null,
    device: typeof body.device === "string" ? body.device : null,
  };
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch("/health");
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch("/api/models");
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.models)) {
    throw new Error("模型列表格式非法。");
  }
  return (body.models as unknown[]).map((entry): ModelInfo => {
    if (!isRecord(entry)) throw new Error("模型条目格式非法。");
    if (
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.type !== "string"
    ) {
      throw new Error("模型条目格式非法。");
    }
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      installed: entry.installed === true,
      loaded: entry.loaded === true,
      mock: entry.mock === true,
    };
  });
}

export async function loadModel(model: string): Promise<void> {
  const response = await fetch("/api/models/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) throw await readError(response);
}

export async function unloadModel(): Promise<void> {
  const response = await fetch("/api/models/unload", { method: "POST" });
  if (!response.ok) throw await readError(response);
}

export async function startModelDownload(model: string): Promise<void> {
  const response = await fetch("/api/setup/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!response.ok) throw await readError(response);
}

export async function fetchDownloadProgress(): Promise<DownloadProgress> {
  const response = await fetch("/api/setup/download");
  if (!response.ok) throw await readError(response);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error("下载进度格式非法。");
  return {
    state: typeof body.state === "string" ? body.state : "idle",
    model_id: typeof body.model_id === "string" ? body.model_id : undefined,
    downloaded_bytes:
      typeof body.downloaded_bytes === "number"
        ? body.downloaded_bytes
        : undefined,
    total_bytes:
      typeof body.total_bytes === "number" ? body.total_bytes : undefined,
    error: typeof body.error === "string" ? body.error : undefined,
  };
}

export function describeApiError(error: unknown): string {
  void errorMessage;
  if (error instanceof Error) return error.message;
  return "请求失败，请检查服务。";
}
