import { createDetectedPayload, normalizeContentType, shouldDetectRequest } from "./detection.js";
import { selectSaveFolder, sendDetectedItem, sendDownloadRequest } from "./api.js";
import type {
  ActiveTabDetectedItemsResponse,
  ConfiguredDownloadPayload,
  DownloadPageVideoResponse,
  ExtensionDetectedItem,
  ExtensionMessage,
  SelectSaveFolderResponse,
} from "./types.js";

const STORAGE_KEY = "detectedItemsByTab";

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    void handleHeadersReceived(details);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"],
);

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "get-active-tab-items") {
    void getActiveTabItems().then(sendResponse);
    return true;
  }

  if (message.type === "clear-active-tab-items") {
    void clearActiveTabItems().then(sendResponse);
    return true;
  }

  if (message.type === "select-save-folder") {
    void chooseSaveFolder().then(sendResponse);
    return true;
  }

  if (message.type === "download-page-video") {
    void downloadPageVideo(message.payload, sender.tab?.id ?? null).then(sendResponse);
    return true;
  }

  return false;
});

async function handleHeadersReceived(details: chrome.webRequest.WebResponseHeadersDetails) {
  if (details.tabId < 0 || !details.url.startsWith("http")) {
    return;
  }

  const contentType = normalizeContentType(
    details.responseHeaders?.find((header) => header.name.toLowerCase() === "content-type")?.value,
  );
  if (!shouldDetectRequest(details.url, contentType)) {
    return;
  }

  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  const pageUrl = tab?.url && tab.url.startsWith("http") ? tab.url : details.initiator ?? details.url;
  const tabTitle = tab?.title ?? "Untitled tab";
  const payload = createDetectedPayload({
    url: details.url,
    pageUrl,
    tabTitle,
    contentType,
  });

  await storeDetectedItem({
    ...payload,
    id: `${details.tabId}:${details.requestId}:${payload.url}`,
    tabId: details.tabId,
  });
}

async function storeDetectedItem(item: ExtensionDetectedItem) {
  const byTab = await getStoredItems();
  const key = String(item.tabId);
  const items = byTab[key] ?? [];
  if (!items.some((existing) => existing.url === item.url)) {
    byTab[key] = [item, ...items].slice(0, 100);
    await chrome.storage.session.set({ [STORAGE_KEY]: byTab });
  }
}

async function downloadPageVideo(
  payload: ConfiguredDownloadPayload,
  tabId: number | null,
): Promise<DownloadPageVideoResponse> {
  try {
    await sendDownloadRequest(payload);
    if (tabId !== null) {
      await storeDetectedItem({
        ...payload,
        id: `${tabId}:page-video:${payload.url}:${payload.detectedAt}`,
        tabId,
      });
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send video to app",
    };
  }
}

async function chooseSaveFolder(): Promise<SelectSaveFolderResponse> {
  try {
    return {
      ok: true,
      savePath: await selectSaveFolder(),
    };
  } catch (error) {
    return {
      ok: false,
      savePath: null,
      error: error instanceof Error ? error.message : "Unable to choose save folder",
    };
  }
}

async function getActiveTabItems(): Promise<ActiveTabDetectedItemsResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { tabId: null, tabTitle: "No active tab", items: [] };
  }
  const byTab = await getStoredItems();
  return {
    tabId: tab.id,
    tabTitle: tab.title ?? "Untitled tab",
    items: byTab[String(tab.id)] ?? [],
  };
}

async function clearActiveTabItems(): Promise<ActiveTabDetectedItemsResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { tabId: null, tabTitle: "No active tab", items: [] };
  }
  const byTab = await getStoredItems();
  byTab[String(tab.id)] = [];
  await chrome.storage.session.set({ [STORAGE_KEY]: byTab });
  return { tabId: tab.id, tabTitle: tab.title ?? "Untitled tab", items: [] };
}

async function getStoredItems(): Promise<Record<string, ExtensionDetectedItem[]>> {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Record<string, ExtensionDetectedItem[]> | undefined) ?? {};
}
