import { describe, expect, test } from "vitest";
import {
  detectFileName,
  getResumeSupport,
  isHttpDownloadUrl,
  MemoryDownloadTask,
} from "./index.js";

describe("download URL validation", () => {
  test("accepts only HTTP and HTTPS URLs", () => {
    expect(isHttpDownloadUrl("https://example.com/file.zip")).toBe(true);
    expect(isHttpDownloadUrl("http://example.com/file.zip")).toBe(true);
    expect(isHttpDownloadUrl("ftp://example.com/file.zip")).toBe(false);
    expect(isHttpDownloadUrl("not a url")).toBe(false);
  });
});

describe("file name detection", () => {
  test("uses Content-Disposition filename before URL fallback", () => {
    expect(
      detectFileName(
        "https://example.com/download?id=123",
        'attachment; filename="report final.pdf"',
      ),
    ).toBe("report final.pdf");
  });

  test("falls back to URL path when Content-Disposition is absent", () => {
    expect(detectFileName("https://example.com/files/archive.zip?token=abc")).toBe(
      "archive.zip",
    );
  });

  test("does not use route-like URL paths as file names", () => {
    expect(detectFileName("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "download",
    );
  });
});

describe("resume support detection", () => {
  test("detects support from Accept-Ranges or a 206 response", () => {
    expect(getResumeSupport({ "accept-ranges": "bytes" }, 200)).toBe(true);
    expect(getResumeSupport({}, 206)).toBe(true);
    expect(getResumeSupport({ "accept-ranges": "none" }, 200)).toBe(false);
  });
});

describe("download task state transitions", () => {
  test("pauses and resumes only when range is supported", () => {
    const task = new MemoryDownloadTask({ rangeSupported: true });

    expect(task.status).toBe("queued");
    task.start();
    expect(task.status).toBe("downloading");
    task.pause();
    expect(task.status).toBe("paused");
    task.resume();
    expect(task.status).toBe("downloading");
  });

  test("fails resume cleanly when range is unsupported", () => {
    const task = new MemoryDownloadTask({ rangeSupported: false });

    task.start();
    task.pause();
    expect(() => task.resume()).toThrow("Server does not support resume");
    expect(task.status).toBe("failed");
  });
});
