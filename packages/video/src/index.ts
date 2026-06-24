import { spawn } from "node:child_process";
import { basename, extname } from "node:path";
import { EventEmitter } from "node:events";

export const DRM_ERROR_MESSAGE = "This video is DRM-protected and cannot be downloaded.";

export type MediaType = "direct-video" | "hls" | "dash" | "web-video" | "normal-file";
export type DownloadType = "file" | "video";
export type VideoStage = "queued" | "analyzing" | "downloading" | "merging" | "completed" | "failed";
export type ToolName = "yt-dlp" | "ffmpeg";

export interface CommandSpec {
  command: string;
  args: string[];
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

export interface VideoProgressEvent {
  stage: VideoStage;
  progress: number;
  speed: number;
  toolUsed: ToolName | null;
  message: string | null;
}

export function detectMediaType(urlValue: string): MediaType {
  let pathname = "";
  let hostname = "";
  try {
    const url = new URL(urlValue);
    pathname = url.pathname.toLowerCase();
    hostname = url.hostname.toLowerCase();
  } catch {
    pathname = urlValue.toLowerCase();
  }

  if (pathname.endsWith(".m3u8")) {
    return "hls";
  }
  if (pathname.endsWith(".mpd")) {
    return "dash";
  }
  if (pathname.endsWith(".mp4") || pathname.endsWith(".webm")) {
    return "direct-video";
  }
  if (isSupportedWebVideoHost(hostname)) {
    return "web-video";
  }
  return "normal-file";
}

export function defaultOutputExtension(mediaType: MediaType, urlValue: string): string {
  if (mediaType === "direct-video") {
    const extension = extname(new URL(urlValue).pathname).replace(".", "");
    return extension || "mp4";
  }
  if (mediaType === "hls" || mediaType === "dash") {
    return "mp4";
  }
  if (mediaType === "web-video") {
    return "mp4";
  }
  const extension = extname(urlValue).replace(".", "");
  return extension || "bin";
}

function isSupportedWebVideoHost(hostname: string): boolean {
  return (
    hostname === "youtu.be" ||
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com")
  );
}

export function defaultVideoFileName(urlValue: string, extension = "mp4"): string {
  try {
    const name = basename(decodeURIComponent(new URL(urlValue).pathname));
    if (name && name.includes(".")) {
      return name.replace(/[\\/:*?"<>|]/g, "_");
    }
  } catch {
    // Fall through to generic name.
  }
  return `video.${extension}`;
}

export function buildVideoFileName(input: {
  url: string;
  requestedName?: string | null;
  extension?: string;
}): string {
  const extension = input.extension ?? "mp4";
  const requestedName = input.requestedName?.trim();
  if (!requestedName) {
    return defaultVideoFileName(input.url, extension);
  }
  const sanitized = requestedName.replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!sanitized) {
    return defaultVideoFileName(input.url, extension);
  }
  return sanitized.includes(".") ? sanitized : `${sanitized}.${extension}`;
}

export function buildYtDlpFormatListCommand(url: string): CommandSpec {
  return {
    command: "yt-dlp",
    args: ["--dump-json", "--no-warnings", url],
  };
}

export function buildYtDlpDownloadCommand(input: {
  url: string;
  outputPath: string;
  formatId?: string | null;
}): CommandSpec {
  const args = [
    "--newline",
    "--no-part",
    "--merge-output-format",
    "mp4",
    "--remux-video",
    "mp4",
  ];
  if (input.formatId) {
    args.push("-f", input.formatId);
  }
  args.push("-o", input.outputPath, input.url);
  return { command: "yt-dlp", args };
}

export function buildFfmpegHlsDashCommand(input: { url: string; outputPath: string }): CommandSpec {
  return {
    command: "ffmpeg",
    args: ["-y", "-i", input.url, "-c", "copy", input.outputPath],
  };
}

export function detectDrmError(output: string): boolean {
  const normalized = output.toLowerCase();
  return [
    "drm",
    "protected",
    "encrypted",
    "encryption",
    "widevine",
    "fairplay",
    "playready",
    "cannot decrypt",
  ].some((needle) => normalized.includes(needle));
}

export function parseYtDlpFormats(value: unknown): FormatOption[] {
  const root = value as {
    ext?: string;
    formats?: Array<{
      format_id?: string;
      format_note?: string;
      ext?: string;
      filesize?: number;
      filesize_approx?: number;
      height?: number;
    }>;
  };

  return (root.formats ?? [])
    .filter((format) => Boolean(format.format_id))
    .map((format) => {
      const height = typeof format.height === "number" ? format.height : null;
      const label = format.format_note || (height ? `${height}p` : format.format_id ?? "unknown");
      return {
        formatId: format.format_id ?? "unknown",
        label,
        extension: format.ext ?? root.ext ?? "mp4",
        estimatedSize: format.filesize ?? format.filesize_approx ?? null,
        height,
      };
    });
}

export async function detectTool(command: ToolName): Promise<ToolStatus> {
  const args = command === "yt-dlp" ? ["--version"] : ["-version"];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      resolve({ name: command, installed: false, version: null });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          name: command,
          installed: true,
          version: output.trim().split(/\s+/)[0] ?? null,
        });
        return;
      }
      resolve({ name: command, installed: false, version: null });
    });
  });
}

export async function analyzeFormats(url: string): Promise<FormatOption[]> {
  const spec = buildYtDlpFormatListCommand(url);
  const result = await runCommand(spec);
  if (detectDrmError(result.stderr) || detectDrmError(result.stdout)) {
    throw new Error(DRM_ERROR_MESSAGE);
  }
  if (result.code !== 0) {
    throw new Error(result.stderr || "Unable to analyze video formats");
  }
  return parseYtDlpFormats(JSON.parse(result.stdout) as unknown);
}

export class VideoDownloadProcess extends EventEmitter<{
  progress: [VideoProgressEvent];
  done: [];
  error: [Error];
}> {
  readonly command: CommandSpec;
  readonly tool: ToolName;

  constructor(command: CommandSpec, tool: ToolName) {
    super();
    this.command = command;
    this.tool = tool;
  }

  start(): void {
    const child = spawn(this.command.command, this.command.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (detectDrmError(text)) {
        child.kill();
        this.emit("error", new Error(DRM_ERROR_MESSAGE));
        return;
      }
      this.emit("progress", parseProgressLine(text, this.tool));
    };

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    child.on("error", (error) => this.emit("error", error));
    child.on("close", (code) => {
      if (code === 0) {
        this.emit("done");
        return;
      }
      this.emit("error", new Error(`${this.tool} exited with code ${code}`));
    });
  }
}

export function parseProgressLine(text: string, tool: ToolName): VideoProgressEvent {
  const percentMatch = /(\d+(?:\.\d+)?)%/.exec(text);
  const progress = percentMatch ? Math.min(100, Number(percentMatch[1])) : 0;
  const stage = /merg|mux|ffmpeg/i.test(text) ? "merging" : "downloading";
  return {
    stage,
    progress,
    speed: 0,
    toolUsed: tool,
    message: text.trim() || null,
  };
}

async function runCommand(spec: CommandSpec): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
