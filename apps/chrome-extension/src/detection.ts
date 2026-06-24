import {
  getDetectedFileName,
  isDetectableContentType,
  isDetectableUrl,
  type DetectedDownloadPayload,
} from "@download-manager/shared";

export function shouldDetectRequest(url: string, contentType?: string | null): boolean {
  return isDetectableUrl(url) || isDetectableContentType(contentType);
}

export function createDetectedPayload(input: {
  url: string;
  pageUrl: string;
  tabTitle: string;
  contentType?: string | null;
  detectedAt?: string;
}): DetectedDownloadPayload {
  return {
    url: input.url,
    pageUrl: input.pageUrl,
    fileName: getDetectedFileName(input.url),
    contentType: normalizeContentType(input.contentType),
    tabTitle: input.tabTitle || "Untitled tab",
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  };
}

export function createVideoElementPayload(input: {
  mediaUrl?: string | null;
  pageUrl: string;
  tabTitle: string;
  detectedAt?: string;
}): DetectedDownloadPayload {
  const mediaUrl = input.mediaUrl?.trim();
  const url = mediaUrl && mediaUrl.startsWith("http") ? mediaUrl : input.pageUrl;
  return createDetectedPayload({
    url,
    pageUrl: input.pageUrl,
    tabTitle: input.tabTitle,
    contentType: "video/mp4",
    detectedAt: input.detectedAt,
  });
}

export function normalizeContentType(contentType?: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}
