import { describe, expect, test, vi } from "vitest";
import { checkDesktopHealth, selectSaveFolder, sendDetectedItem, sendDownloadRequest } from "./api.js";
import { createVideoElementPayload } from "./detection.js";

describe("extension desktop API client", () => {
  test("returns true when health endpoint responds ok", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await expect(checkDesktopHealth(fetcher as unknown as typeof fetch)).resolves.toBe(true);
  });

  test("posts selected detected item to Electron", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await sendDetectedItem({
      url: "https://example.com/file.pdf",
      pageUrl: "https://example.com/page",
      fileName: "file.pdf",
      contentType: "application/pdf",
      tabTitle: "Example",
      detectedAt: "2026-06-22T00:00:00.000Z",
    }, fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:17891/detected",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("posts overlay video downloads to Electron", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await sendDownloadRequest({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      fileName: "detected-download",
      savePath: "/Users/example/Downloads",
      contentType: "video/mp4",
      tabTitle: "Example",
      detectedAt: "2026-06-22T00:00:00.000Z",
    }, fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:17891/download",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("asks Electron to choose a save folder", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, savePath: "/Users/example/Downloads" }),
    });

    await expect(selectSaveFolder(fetcher as unknown as typeof fetch)).resolves.toBe(
      "/Users/example/Downloads",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:17891/save-folder",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("video element payloads", () => {
  test("uses direct media URLs when the video source is downloadable", () => {
    expect(
      createVideoElementPayload({
        mediaUrl: "https://cdn.example.com/video.mp4",
        pageUrl: "https://example.com/watch",
        tabTitle: "Example video",
        detectedAt: "2026-06-24T00:00:00.000Z",
      }),
    ).toMatchObject({
      url: "https://cdn.example.com/video.mp4",
      pageUrl: "https://example.com/watch",
      fileName: "video.mp4",
      contentType: "video/mp4",
    });
  });

  test("falls back to the page URL for blob video sources", () => {
    expect(
      createVideoElementPayload({
        mediaUrl: "blob:https://www.youtube.com/id",
        pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        tabTitle: "Example video",
        detectedAt: "2026-06-24T00:00:00.000Z",
      }),
    ).toMatchObject({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      fileName: "detected-download",
      contentType: "video/mp4",
    });
  });
});
