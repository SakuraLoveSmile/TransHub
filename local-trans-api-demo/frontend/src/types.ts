export type SubtitleMode = "transcribe" | "translate";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface TaskErrorInfo {
  code: string;
  detail: string;
}

export interface SubtitleTaskResult {
  model: string;
  text: string;
  duration: number;
  processing_time: number;
}

export interface SubtitleTask {
  id: string;
  mode: SubtitleMode;
  status: TaskStatus;
  stage: string;
  original_name: string;
  mock: boolean;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  result: SubtitleTaskResult | null;
  downloads: { srt: string; lrc: string } | null;
  error: TaskErrorInfo | null;
}

export interface TaskListResponse {
  tasks: SubtitleTask[];
  total: number;
  limit: number;
  offset: number;
}

export interface ServiceStatus {
  status: string;
  engine: string;
  mock: boolean;
  loaded_model: string | null;
  device: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  type: string;
  installed: boolean;
  loaded: boolean;
  mock: boolean;
}

export interface DownloadProgress {
  state: string;
  model_id?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
}
