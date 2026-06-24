import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DownloadDatabase } from "@download-manager/database";
import { createLocalDetectionServer } from "./local-server.js";

const tempDirs: string[] = [];

function createDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "download-manager-server-"));
  tempDirs.push(dir);
  return new DownloadDatabase(join(dir, "downloads.sqlite"));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("local detection server", () => {
  test("returns JSON health status", async () => {
    const database = createDatabase();
    const server = createLocalDetectionServer({ database });
    await server.listen(0);

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = await response.json() as { ok: boolean; service: string };

    await server.close();
    database.close();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, service: "download-manager" });
  });

  test("rejects invalid detected payloads", async () => {
    const database = createDatabase();
    const server = createLocalDetectionServer({ database });
    await server.listen(0);

    const response = await fetch(`http://127.0.0.1:${server.port}/detected`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "file:///private.mov" }),
    });

    await server.close();
    database.close();

    expect(response.status).toBe(400);
  });

  test("stores valid detected payloads", async () => {
    const database = createDatabase();
    const server = createLocalDetectionServer({ database });
    await server.listen(0);

    const response = await fetch(`http://127.0.0.1:${server.port}/detected`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/file.pdf",
        pageUrl: "https://example.com/page",
        fileName: "file.pdf",
        contentType: "application/pdf",
        tabTitle: "Example Page",
        detectedAt: "2026-06-22T00:00:00.000Z",
      }),
    });
    const items = database.getDetectedItems();

    await server.close();
    database.close();

    expect(response.status).toBe(201);
    expect(items).toHaveLength(1);
    expect(items[0]?.fileName).toBe("file.pdf");
  });

  test("forwards valid download payloads to the app download handler", async () => {
    const database = createDatabase();
    const server = createLocalDetectionServer({
      database,
      onDownloadRequest: (payload) => ({
        id: "download-1",
        url: payload.url,
        fileName: `${payload.fileName}.mp4`,
      }),
    });
    await server.listen(0);

    const response = await fetch(`http://127.0.0.1:${server.port}/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        fileName: "my-video",
        savePath: "/Users/example/Downloads",
        contentType: "video/mp4",
        tabTitle: "Example Page",
        detectedAt: "2026-06-22T00:00:00.000Z",
      }),
    });
    const body = await response.json() as { ok: boolean; download?: { id: string } };

    await server.close();
    database.close();

    expect(response.status).toBe(201);
    expect(body).toEqual({ ok: true, download: { id: "download-1", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", fileName: "my-video.mp4" } });
  });

  test("returns a selected save folder", async () => {
    const database = createDatabase();
    const requests: unknown[] = [];
    const server = createLocalDetectionServer({
      database,
      onSelectSaveFolder: (request) => {
        requests.push(request);
        return "/Users/example/Downloads";
      },
    });
    await server.listen(0);

    const response = await fetch(`http://127.0.0.1:${server.port}/save-folder`);
    const body = await response.json() as { ok: boolean; savePath: string };

    await server.close();
    database.close();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, savePath: "/Users/example/Downloads" });
    expect(requests).toEqual([{ source: "browser-extension", attachToMainWindow: false }]);
  });
});
