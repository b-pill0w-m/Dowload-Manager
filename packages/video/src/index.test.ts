import { describe, expect, test } from "vitest";
import {
  buildFfmpegHlsDashCommand,
  buildYtDlpDownloadCommand,
  buildYtDlpFormatListCommand,
  buildVideoFileName,
  detectDrmError,
  detectMediaType,
  parseYtDlpFormats,
} from "./index.js";

describe("media type detection", () => {
  test("detects direct video, HLS, DASH, and normal files", () => {
    expect(detectMediaType("https://example.com/video.mp4")).toBe("direct-video");
    expect(detectMediaType("https://example.com/video.webm?token=1")).toBe("direct-video");
    expect(detectMediaType("https://example.com/master.m3u8")).toBe("hls");
    expect(detectMediaType("https://example.com/manifest.mpd")).toBe("dash");
    expect(detectMediaType("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("web-video");
    expect(detectMediaType("https://youtu.be/dQw4w9WgXcQ")).toBe("web-video");
    expect(detectMediaType("https://example.com/file.pdf")).toBe("normal-file");
  });
});

describe("video file names", () => {
  test("adds the output extension when the user omits it", () => {
    expect(buildVideoFileName({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      requestedName: "my video",
      extension: "mp4",
    })).toBe("my video.mp4");
  });

  test("keeps an explicit extension", () => {
    expect(buildVideoFileName({
      url: "https://example.com/video.webm",
      requestedName: "clip.webm",
      extension: "mp4",
    })).toBe("clip.webm");
  });
});

describe("command builders", () => {
  test("builds yt-dlp format list command", () => {
    expect(buildYtDlpFormatListCommand("https://example.com/master.m3u8")).toEqual({
      command: "yt-dlp",
      args: ["--dump-json", "--no-warnings", "https://example.com/master.m3u8"],
    });
  });

  test("builds yt-dlp download command with selected format", () => {
    expect(
      buildYtDlpDownloadCommand({
        url: "https://example.com/master.m3u8",
        outputPath: "/tmp/video.mp4",
        formatId: "137+140",
      }),
    ).toEqual({
      command: "yt-dlp",
      args: [
        "--newline",
        "--no-part",
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "-f",
        "137+140",
        "-o",
        "/tmp/video.mp4",
        "https://example.com/master.m3u8",
      ],
    });
  });

  test("builds ffmpeg HLS/DASH fallback command", () => {
    expect(
      buildFfmpegHlsDashCommand({
        url: "https://example.com/master.m3u8",
        outputPath: "/tmp/video.mp4",
      }),
    ).toEqual({
      command: "ffmpeg",
      args: [
        "-y",
        "-i",
        "https://example.com/master.m3u8",
        "-c",
        "copy",
        "/tmp/video.mp4",
      ],
    });
  });
});

describe("DRM detection", () => {
  test("detects protected stream output", () => {
    expect(detectDrmError("ERROR: This video is DRM protected")).toBe(true);
    expect(detectDrmError("encryption scheme is unsupported")).toBe(true);
    expect(detectDrmError("Downloading fragment 1 of 10")).toBe(false);
  });
});

describe("yt-dlp format parsing", () => {
  test("maps formats into quality options", () => {
    const formats = parseYtDlpFormats({
      ext: "mp4",
      formats: [
        {
          format_id: "18",
          format_note: "360p",
          ext: "mp4",
          filesize: 1000,
          height: 360,
        },
      ],
    });

    expect(formats).toEqual([
      {
        formatId: "18",
        label: "360p",
        extension: "mp4",
        estimatedSize: 1000,
        height: 360,
      },
    ]);
  });
});
