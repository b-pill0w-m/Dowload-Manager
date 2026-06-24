import type { DetectedDownloadPayload } from "@download-manager/shared";

export interface ExtensionDetectedItem extends DetectedDownloadPayload {
  id: string;
  tabId: number;
}

export interface ActiveTabDetectedItemsResponse {
  tabId: number | null;
  tabTitle: string;
  items: ExtensionDetectedItem[];
}

export interface ConfiguredDownloadPayload extends DetectedDownloadPayload {
  savePath: string;
}

export type ExtensionMessage =
  | { type: "get-active-tab-items" }
  | { type: "clear-active-tab-items" }
  | { type: "select-save-folder" }
  | { type: "download-page-video"; payload: ConfiguredDownloadPayload };

export interface DownloadPageVideoResponse {
  ok: boolean;
  error?: string;
}

export interface SelectSaveFolderResponse {
  ok: boolean;
  savePath: string | null;
  error?: string;
}
