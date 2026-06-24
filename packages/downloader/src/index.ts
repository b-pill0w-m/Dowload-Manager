import { EventEmitter } from "node:events";
import { createWriteStream, existsSync, promises as fsPromises, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { DownloadProgressEvent, DownloadStatus } from "@download-manager/shared";

const FALLBACK_FILE_NAME = "download";
const PROGRESS_INTERVAL_MS = 250;

export function isHttpDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function detectFileName(urlValue: string, contentDisposition?: string | null): string {
  const fromDisposition = parseContentDispositionFileName(contentDisposition);
  if (fromDisposition) {
    return sanitizeFileName(fromDisposition);
  }

  try {
    const url = new URL(urlValue);
    const pathName = decodeURIComponent(url.pathname);
    const fromUrl = basename(pathName);
    if (fromUrl && fromUrl !== "/" && fromUrl !== "." && fromUrl.includes(".") && !fromUrl.startsWith(".")) {
      return sanitizeFileName(fromUrl);
    }
  } catch {
    // URL validation happens before download start.
  }

  return FALLBACK_FILE_NAME;
}

export function getResumeSupport(headers: IncomingHttpHeaders, statusCode = 200): boolean {
  const acceptRanges = String(headers["accept-ranges"] ?? "").toLowerCase();
  return statusCode === 206 || acceptRanges === "bytes";
}

export function partFilePath(finalPath: string): string {
  return `${finalPath}.part`;
}

function parseContentDispositionFileName(header?: string | null): string | null {
  if (!header) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(header);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = /filename=([^;]+)/i.exec(header);
  return plainMatch?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return sanitized || FALLBACK_FILE_NAME;
}

function percent(downloadedSize: number, totalSize: number | null): number {
  if (!totalSize || totalSize <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((downloadedSize / totalSize) * 10000) / 100);
}

export interface DownloadTaskOptions {
  id: string;
  url: string;
  saveDirectory: string;
  fileName?: string;
}

export interface DownloadTaskEvents {
  progress: [DownloadProgressEvent];
  status: [DownloadProgressEvent];
  error: [Error];
}

export class DownloadTask extends EventEmitter<DownloadTaskEvents> {
  readonly id: string;
  readonly url: string;
  readonly saveDirectory: string;

  fileName: string;
  totalSize: number | null = null;
  downloadedSize = 0;
  speed = 0;
  status: DownloadStatus = "queued";
  errorMessage: string | null = null;
  rangeSupported = false;

  #activeRequest: ReturnType<typeof httpRequest> | ReturnType<typeof httpsRequest> | null = null;
  #intentionalAbort = false;
  #lastBytes = 0;
  #lastTick = Date.now();
  #progressTimer: NodeJS.Timeout | null = null;

  constructor(options: DownloadTaskOptions) {
    super();
    if (!isHttpDownloadUrl(options.url)) {
      throw new Error("Only HTTP and HTTPS URLs are supported");
    }
    this.id = options.id;
    this.url = options.url;
    this.saveDirectory = options.saveDirectory;
    this.fileName = options.fileName ?? detectFileName(options.url);
  }

  get finalPath(): string {
    return join(this.saveDirectory, this.fileName);
  }

  get partialPath(): string {
    return partFilePath(this.finalPath);
  }

  async start(): Promise<void> {
    await this.#begin({ resume: false });
  }

  async resume(): Promise<void> {
    const existingBytes = existsSync(this.partialPath) ? statSync(this.partialPath).size : 0;
    if (existingBytes > 0 && !this.rangeSupported) {
      this.#fail(new Error("Server does not support resume"));
      return;
    }
    await this.#begin({ resume: existingBytes > 0 });
  }

  pause(): void {
    if (this.status !== "downloading") {
      return;
    }
    this.#intentionalAbort = true;
    this.status = "paused";
    this.#stopProgressTimer();
    this.#activeRequest?.destroy();
    this.#emitStatus();
  }

  cancel(): void {
    this.#intentionalAbort = true;
    this.status = "canceled";
    this.#stopProgressTimer();
    this.#activeRequest?.destroy();
    this.#emitStatus();
  }

  async retry(): Promise<void> {
    await fsPromises.rm(this.partialPath, { force: true });
    this.downloadedSize = 0;
    this.totalSize = null;
    this.errorMessage = null;
    this.rangeSupported = false;
    await this.#begin({ resume: false });
  }

  async #begin({ resume }: { resume: boolean }): Promise<void> {
    this.#intentionalAbort = false;
    this.status = "downloading";
    this.errorMessage = null;
    await fsPromises.mkdir(this.saveDirectory, { recursive: true });

    const resumeBytes = resume && existsSync(this.partialPath) ? statSync(this.partialPath).size : 0;
    this.downloadedSize = resumeBytes;
    const url = new URL(this.url);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {};
    if (resumeBytes > 0) {
      headers.Range = `bytes=${resumeBytes}-`;
    }

    this.#lastBytes = this.downloadedSize;
    this.#lastTick = Date.now();
    this.#startProgressTimer();
    this.#emitStatus();

    await new Promise<void>((resolve) => {
      const request = transport(url, { headers }, (response) => {
        void this.#handleResponse(response, { resumeBytes }).then(resolve);
      });
      this.#activeRequest = request;
      request.on("error", (error) => {
        if (!this.#intentionalAbort) {
          this.#fail(error);
        }
        resolve();
      });
      request.end();
    });
  }

  async #handleResponse(response: IncomingMessage, options: { resumeBytes: number }): Promise<void> {
    const statusCode = response.statusCode ?? 0;
    const isResume = options.resumeBytes > 0;

    if (isResume && statusCode !== 206) {
      response.resume();
      this.#fail(new Error("Server does not support resume"));
      return;
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      this.#fail(new Error(`Download failed with HTTP ${statusCode}`));
      return;
    }

    this.rangeSupported = getResumeSupport(response.headers, statusCode);
    const detectedName = detectFileName(this.url, response.headers["content-disposition"]);
    if (!existsSync(this.partialPath) && detectedName !== this.fileName) {
      this.fileName = detectedName;
    }

    const contentLength = Number(response.headers["content-length"] ?? 0);
    this.totalSize = Number.isFinite(contentLength) && contentLength > 0
      ? contentLength + options.resumeBytes
      : null;

    const stream = createWriteStream(this.partialPath, {
      flags: options.resumeBytes > 0 ? "a" : "w",
    });

    response.on("data", (chunk: Buffer) => {
      this.downloadedSize += chunk.length;
      this.emit("progress", this.#event());
    });

    try {
      await pipeline(response, stream);
      if (this.#intentionalAbort) {
        return;
      }
      await fsPromises.mkdir(dirname(this.finalPath), { recursive: true });
      await fsPromises.rename(this.partialPath, this.finalPath);
      this.downloadedSize = this.totalSize ?? this.downloadedSize;
      this.status = "completed";
      this.speed = 0;
      this.#stopProgressTimer();
      this.#emitStatus();
    } catch (error) {
      if (!this.#intentionalAbort) {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  #startProgressTimer(): void {
    this.#stopProgressTimer();
    this.#progressTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(1, now - this.#lastTick) / 1000;
      this.speed = Math.max(0, Math.round((this.downloadedSize - this.#lastBytes) / elapsed));
      this.#lastBytes = this.downloadedSize;
      this.#lastTick = now;
      if (this.status === "downloading") {
        this.emit("progress", this.#event());
      }
    }, PROGRESS_INTERVAL_MS);
  }

  #stopProgressTimer(): void {
    if (this.#progressTimer) {
      clearInterval(this.#progressTimer);
      this.#progressTimer = null;
    }
  }

  #fail(error: Error): void {
    this.status = "failed";
    this.errorMessage = error.message;
    this.speed = 0;
    this.#stopProgressTimer();
    this.emit("error", error);
    this.#emitStatus();
  }

  #emitStatus(): void {
    this.emit("status", this.#event());
    this.emit("progress", this.#event());
  }

  #event(): DownloadProgressEvent {
    return {
      id: this.id,
      url: this.url,
      fileName: this.fileName,
      savePath: this.finalPath,
      totalSize: this.totalSize,
      downloadedSize: this.downloadedSize,
      progress: percent(this.downloadedSize, this.totalSize),
      speed: this.speed,
      status: this.status,
      errorMessage: this.errorMessage,
    };
  }
}

export class MemoryDownloadTask {
  status: DownloadStatus = "queued";
  readonly rangeSupported: boolean;

  constructor(options: { rangeSupported: boolean }) {
    this.rangeSupported = options.rangeSupported;
  }

  start(): void {
    this.status = "downloading";
  }

  pause(): void {
    if (this.status === "downloading") {
      this.status = "paused";
    }
  }

  resume(): void {
    if (!this.rangeSupported) {
      this.status = "failed";
      throw new Error("Server does not support resume");
    }
    this.status = "downloading";
  }
}
