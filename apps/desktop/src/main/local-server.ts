import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DownloadDatabase } from "@download-manager/database";
import {
  type DetectedDownloadItem,
  type DetectedDownloadPayload,
  type DownloadRecord,
  isValidDetectedPayload,
} from "@download-manager/shared";

const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_DETECTION_PORT = 17891;

export interface LocalDetectionServerOptions {
  database: DownloadDatabase;
  onDetectedItem?: (item: DetectedDownloadItem) => void;
  onDownloadRequest?: (payload: ConfiguredDownloadPayload) => Pick<DownloadRecord, "id" | "url" | "fileName">;
  onSelectSaveFolder?: (request: SelectSaveFolderRequest) => string | null | Promise<string | null>;
  host?: string;
}

export interface ConfiguredDownloadPayload extends DetectedDownloadPayload {
  savePath: string;
}

export interface SelectSaveFolderRequest {
  source: "browser-extension";
  attachToMainWindow: false;
}

export interface LocalDetectionServer {
  readonly port: number;
  listen(port?: number): Promise<void>;
  close(): Promise<void>;
}

export function createLocalDetectionServer(options: LocalDetectionServerOptions): LocalDetectionServer {
  let activePort = 0;
  const host = options.host ?? DEFAULT_HOST;

  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { ok: true, service: "download-manager" });
      return;
    }

    if (request.method === "GET" && request.url === "/save-folder") {
      await handleSelectSaveFolder(response, options);
      return;
    }

    if (request.method === "POST" && request.url === "/detected") {
      await handleDetected(request, response, options);
      return;
    }

    if (request.method === "POST" && request.url === "/download") {
      await handleDownload(request, response, options);
      return;
    }

    writeJson(response, 404, { ok: false, error: "Not found" });
  });

  return {
    get port() {
      return activePort;
    },
    listen(port = DEFAULT_DETECTION_PORT) {
      return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          activePort = (server.address() as AddressInfo).port;
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleSelectSaveFolder(
  response: ServerResponse,
  options: LocalDetectionServerOptions,
) {
  if (!options.onSelectSaveFolder) {
    writeJson(response, 503, { ok: false, error: "Save folder picker is not available" });
    return;
  }

  const savePath = await options.onSelectSaveFolder({
    source: "browser-extension",
    attachToMainWindow: false,
  });
  writeJson(response, 200, { ok: true, savePath });
}

async function handleDetected(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalDetectionServerOptions,
) {
  try {
    const payload = await readJson(request);
    if (!isValidDetectedPayload(payload)) {
      writeJson(response, 400, { ok: false, error: "Invalid detected item payload" });
      return;
    }

    const item = options.database.createDetectedItem(normalizePayload(payload));
    options.onDetectedItem?.(item);
    writeJson(response, 201, { ok: true, item });
  } catch (error) {
    writeJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

async function handleDownload(
  request: IncomingMessage,
  response: ServerResponse,
  options: LocalDetectionServerOptions,
) {
  try {
    const payload = await readJson(request);
    if (!isValidConfiguredDownloadPayload(payload)) {
      writeJson(response, 400, { ok: false, error: "Invalid download payload" });
      return;
    }
    if (!options.onDownloadRequest) {
      writeJson(response, 503, { ok: false, error: "Download handler is not available" });
      return;
    }

    const download = options.onDownloadRequest(normalizeConfiguredPayload(payload));
    writeJson(response, 201, { ok: true, download });
  } catch (error) {
    writeJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

function isValidConfiguredDownloadPayload(value: unknown): value is ConfiguredDownloadPayload {
  return (
    isValidDetectedPayload(value) &&
    typeof (value as Partial<ConfiguredDownloadPayload>).savePath === "string" &&
    (value as Partial<ConfiguredDownloadPayload>).savePath?.trim() !== ""
  );
}

function normalizeConfiguredPayload(payload: ConfiguredDownloadPayload): ConfiguredDownloadPayload {
  return {
    ...normalizePayload(payload),
    savePath: payload.savePath.trim(),
  };
}

function normalizePayload(payload: DetectedDownloadPayload): DetectedDownloadPayload {
  return {
    url: payload.url,
    pageUrl: payload.pageUrl,
    fileName: payload.fileName.trim() || "detected-download",
    contentType: payload.contentType.trim() || "application/octet-stream",
    tabTitle: payload.tabTitle.trim() || "Untitled tab",
    detectedAt: payload.detectedAt,
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    throw new Error("Request body is required");
  }
  return JSON.parse(text) as unknown;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
