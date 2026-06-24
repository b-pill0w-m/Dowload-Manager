import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { DownloadDatabase } from "./index.js";

const tempDirs: string[] = [];

function createTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "download-manager-db-"));
  tempDirs.push(dir);
  return join(dir, "downloads.sqlite");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("DownloadDatabase", () => {
  test("initializes the downloads schema", () => {
    const database = new DownloadDatabase(createTempDbPath());

    const tables = database.listTables();
    database.close();

    expect(tables).toContain("downloads");
  });

  test("persists download status changes", () => {
    const database = new DownloadDatabase(createTempDbPath());
    const created = database.createDownload({
      url: "https://example.com/file.pdf",
      fileName: "file.pdf",
      savePath: "/tmp/file.pdf",
      totalSize: 100,
    });

    database.updateDownload(created.id, {
      status: "downloading",
      downloadedSize: 50,
      progress: 50,
      speed: 1000,
    });

    const updated = database.getDownload(created.id);
    database.close();

    expect(updated?.status).toBe("downloading");
    expect(updated?.downloadedSize).toBe(50);
    expect(updated?.progress).toBe(50);
    expect(updated?.speed).toBe(1000);
  });

  test("persists and ignores detected download items", () => {
    const database = new DownloadDatabase(createTempDbPath());
    const item = database.createDetectedItem({
      url: "https://example.com/file.mp4",
      pageUrl: "https://example.com/watch/1",
      fileName: "file.mp4",
      contentType: "video/mp4",
      tabTitle: "Example Page",
      detectedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(database.getDetectedItems()).toHaveLength(1);

    const ignored = database.ignoreDetectedItem(item.id);
    database.close();

    expect(ignored.status).toBe("ignored");
    expect(ignored.ignoredAt).not.toBeNull();
  });
});
