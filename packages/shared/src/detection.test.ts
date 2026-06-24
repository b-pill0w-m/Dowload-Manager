import { describe, expect, test } from "vitest";
import {
  DETECTABLE_CONTENT_TYPES,
  DETECTABLE_EXTENSIONS,
  getDetectedFileName,
  isDetectableContentType,
  isDetectableUrl,
} from "./index.js";

describe("Phase 2 detection rules", () => {
  test("detects supported URL extensions", () => {
    expect(DETECTABLE_EXTENSIONS).toContain(".mp4");
    expect(isDetectableUrl("https://example.com/video.mp4?token=abc")).toBe(true);
    expect(isDetectableUrl("https://example.com/report.pdf")).toBe(true);
    expect(isDetectableUrl("https://example.com/page.html")).toBe(false);
  });

  test("detects supported content types", () => {
    expect(DETECTABLE_CONTENT_TYPES).toContain("application/pdf");
    expect(isDetectableContentType("video/mp4")).toBe(true);
    expect(isDetectableContentType("audio/mpeg; charset=binary")).toBe(true);
    expect(isDetectableContentType("application/pdf")).toBe(true);
    expect(isDetectableContentType("text/html")).toBe(false);
  });

  test("extracts a safe file name from a detected URL", () => {
    expect(getDetectedFileName("https://example.com/path/my%20file.mkv?x=1")).toBe(
      "my file.mkv",
    );
    expect(getDetectedFileName("https://example.com/watch/")).toBe("detected-download");
  });
});
