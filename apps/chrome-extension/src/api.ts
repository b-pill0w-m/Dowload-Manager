import type { DetectedDownloadPayload } from "@download-manager/shared";
import type { ConfiguredDownloadPayload } from "./types.js";

export const ELECTRON_BASE_URL = "http://127.0.0.1:17891";

export async function checkDesktopHealth(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${ELECTRON_BASE_URL}/health`, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.json() as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function sendDetectedItem(
  item: DetectedDownloadPayload,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`${ELECTRON_BASE_URL}/detected`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    throw new Error(`Desktop app rejected detected item (${response.status})`);
  }
}

export async function sendDownloadRequest(
  item: ConfiguredDownloadPayload,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`${ELECTRON_BASE_URL}/download`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(item),
  });
  if (!response.ok) {
    throw new Error(`Desktop app rejected download request (${response.status})`);
  }
}

export async function selectSaveFolder(fetcher: typeof fetch = fetch): Promise<string | null> {
  const response = await fetcher(`${ELECTRON_BASE_URL}/save-folder`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Desktop app rejected save folder request (${response.status})`);
  }
  const body = await response.json() as { ok?: boolean; savePath?: string | null; error?: string };
  if (body.ok !== true) {
    throw new Error(body.error ?? "Unable to choose save folder");
  }
  return body.savePath ?? null;
}
