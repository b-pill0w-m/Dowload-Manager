export const DOWNLOAD_STATUSES = [
  "queued",
  "downloading",
  "paused",
  "completed",
  "failed",
  "canceled",
] as const;

export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];

export const DOWNLOAD_TYPES = ["file", "video"] as const;
export const MEDIA_TYPES = ["normal-file", "direct-video", "hls", "dash", "web-video"] as const;
export const VIDEO_STAGES = ["queued", "analyzing", "downloading", "merging", "completed", "failed"] as const;
export const TOOL_NAMES = ["yt-dlp", "ffmpeg"] as const;

export type DownloadType = (typeof DOWNLOAD_TYPES)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type VideoStage = (typeof VIDEO_STAGES)[number];
export type ToolName = (typeof TOOL_NAMES)[number];

export const DETECTABLE_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mkv",
  ".mov",
  ".m3u8",
  ".mpd",
  ".ts",
  ".m4s",
  ".m4a",
  ".vtt",
  ".zip",
  ".pdf",
  ".docx",
  ".xlsx",
] as const;

export const DETECTABLE_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml",
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export const DETECTED_ITEM_STATUSES = ["new", "ignored", "downloaded"] as const;

export type DetectedItemStatus = (typeof DETECTED_ITEM_STATUSES)[number];

export interface DownloadRecord {
  id: string;
  url: string;
  fileName: string;
  savePath: string;
  totalSize: number | null;
  downloadedSize: number;
  progress: number;
  speed: number;
  status: DownloadStatus;
  errorMessage: string | null;
  downloadType: DownloadType;
  mediaType: MediaType;
  selectedFormat: string | null;
  outputExtension: string | null;
  toolUsed: ToolName | null;
  stage: VideoStage | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface DetectedDownloadPayload {
  url: string;
  pageUrl: string;
  fileName: string;
  contentType: string;
  tabTitle: string;
  detectedAt: string;
}

export interface DetectedDownloadItem extends DetectedDownloadPayload {
  id: string;
  status: DetectedItemStatus;
  createdAt: string;
  updatedAt: string;
  ignoredAt: string | null;
  downloadedAt: string | null;
  mediaType: MediaType;
}

export interface CreateDownloadInput {
  url: string;
  fileName: string;
  savePath: string;
  totalSize?: number | null;
  downloadType?: DownloadType;
  mediaType?: MediaType;
  selectedFormat?: string | null;
  outputExtension?: string | null;
  toolUsed?: ToolName | null;
  stage?: VideoStage | null;
}

export interface UpdateDownloadInput {
  fileName?: string;
  savePath?: string;
  totalSize?: number | null;
  downloadedSize?: number;
  progress?: number;
  speed?: number;
  status?: DownloadStatus;
  errorMessage?: string | null;
  downloadType?: DownloadType;
  mediaType?: MediaType;
  selectedFormat?: string | null;
  outputExtension?: string | null;
  toolUsed?: ToolName | null;
  stage?: VideoStage | null;
  completedAt?: string | null;
}

export interface AddDownloadRequest {
  url: string;
  savePath: string;
}

export interface DownloadProgressEvent {
  id: string;
  url: string;
  fileName: string;
  savePath: string;
  totalSize: number | null;
  downloadedSize: number;
  progress: number;
  speed: number;
  status: DownloadStatus;
  errorMessage: string | null;
  stage?: VideoStage | null;
  toolUsed?: ToolName | null;
}

export interface FormatOption {
  formatId: string;
  label: string;
  extension: string;
  estimatedSize: number | null;
  height: number | null;
}

export interface ToolStatus {
  name: ToolName;
  installed: boolean;
  version: string | null;
}

export interface ToolStatusMap {
  ytdlp: ToolStatus;
  ffmpeg: ToolStatus;
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const IPC_CHANNELS = {
  addDownload: "downloads:add",
  pauseDownload: "downloads:pause",
  resumeDownload: "downloads:resume",
  cancelDownload: "downloads:cancel",
  retryDownload: "downloads:retry",
  getDownloads: "downloads:list",
  selectSaveFolder: "downloads:select-save-folder",
  downloadProgress: "downloads:progress",
  getDetectedItems: "detected:list",
  ignoreDetectedItem: "detected:ignore",
  downloadDetectedItem: "detected:download",
  detectedItemReceived: "detected:received",
  getToolStatus: "tools:status",
  analyzeDetectedItemFormats: "detected:analyze-formats",
} as const;

export function isDetectableUrl(value: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(value).pathname.toLowerCase();
  } catch {
    return false;
  }
  return DETECTABLE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

export function isDetectableContentType(value?: string | null): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    normalized.startsWith("video/") ||
    normalized.startsWith("audio/") ||
    DETECTABLE_CONTENT_TYPES.includes(normalized as (typeof DETECTABLE_CONTENT_TYPES)[number])
  );
}

export function getDetectedFileName(value: string): string {
  try {
    const url = new URL(value);
    const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    const candidate = segments.at(-1)?.trim();
    if (candidate && candidate.includes(".") && !candidate.startsWith(".")) {
      return candidate.replace(/[\\/:*?"<>|]/g, "_");
    }
  } catch {
    // Invalid URLs are rejected by payload validation.
  }
  return "detected-download";
}

export function isValidDetectedPayload(value: unknown): value is DetectedDownloadPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<DetectedDownloadPayload>;
  if (
    typeof item.url !== "string" ||
    typeof item.pageUrl !== "string" ||
    typeof item.fileName !== "string" ||
    typeof item.contentType !== "string" ||
    typeof item.tabTitle !== "string" ||
    typeof item.detectedAt !== "string"
  ) {
    return false;
  }
  try {
    const url = new URL(item.url);
    const pageUrl = new URL(item.pageUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    if (!["http:", "https:"].includes(pageUrl.protocol)) {
      return false;
    }
  } catch {
    return false;
  }
  return !Number.isNaN(Date.parse(item.detectedAt));
}
