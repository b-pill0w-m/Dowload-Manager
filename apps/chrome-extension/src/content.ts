import type { DetectedDownloadPayload } from "@download-manager/shared";
import type { ConfiguredDownloadPayload, DownloadPageVideoResponse, SelectSaveFolderResponse } from "./types.js";

const BUTTON_CLASS = "download-manager-video-button";
const MODAL_CLASS = "download-manager-video-modal";
const TOAST_CLASS = "download-manager-video-toast";
const MIN_VIDEO_SIZE = 120;

const overlays = new WeakMap<HTMLVideoElement, HTMLButtonElement>();
const sendingButtons = new WeakSet<HTMLButtonElement>();
let activeVideo: HTMLVideoElement | null = null;

init();

function init() {
  injectStyles();
  scanVideos();
  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("scroll", updateOverlayPositions, true);
  window.addEventListener("resize", updateOverlayPositions);

  const observer = new MutationObserver(() => {
    scanVideos();
    updateOverlayPositions();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function scanVideos() {
  document.querySelectorAll("video").forEach((node) => {
    if (node instanceof HTMLVideoElement) {
      ensureOverlay(node);
    }
  });
  activeVideo ??= findLargestVisibleVideo();
  updateOverlayPositions();
}

function handleMouseMove(event: MouseEvent) {
  const video = findVideoAtPoint(event.clientX, event.clientY);
  if (!video) {
    return;
  }
  activeVideo = video;
  ensureOverlay(video);
  updateOverlayPositions();
}

function findVideoAtPoint(clientX: number, clientY: number): HTMLVideoElement | null {
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (element instanceof HTMLVideoElement) {
      return element;
    }
    const video = element.querySelector?.("video");
    if (video instanceof HTMLVideoElement) {
      return video;
    }
  }
  return null;
}

function ensureOverlay(video: HTMLVideoElement) {
  if (overlays.has(video)) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.textContent = "Download";
  button.title = "Send video to Download Manager";
  const handlePress = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if ("stopImmediatePropagation" in event) {
      event.stopImmediatePropagation();
    }
    openDownloadDialog(video);
  };
  button.addEventListener("pointerdown", handlePress, true);
  button.addEventListener("mousedown", handlePress, true);
  button.addEventListener("click", handlePress, true);
  document.documentElement.append(button);
  overlays.set(video, button);
}

function updateOverlayPositions() {
  activeVideo ??= findLargestVisibleVideo();
  for (const video of document.querySelectorAll("video")) {
    if (!(video instanceof HTMLVideoElement)) {
      continue;
    }
    const button = overlays.get(video);
    if (!button) {
      continue;
    }

    const rect = video.getBoundingClientRect();
    const visible = isUsableVideoRect(rect) && video === activeVideo;
    button.hidden = !visible;
    if (!visible) {
      continue;
    }

    button.style.top = `${Math.max(8, rect.top + 10)}px`;
    button.style.left = `${Math.max(8, rect.right - button.offsetWidth - 10)}px`;
  }
}

function findLargestVisibleVideo(): HTMLVideoElement | null {
  let bestVideo: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const video of document.querySelectorAll("video")) {
    if (!(video instanceof HTMLVideoElement)) {
      continue;
    }
    const rect = video.getBoundingClientRect();
    if (!isUsableVideoRect(rect)) {
      continue;
    }
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestVideo = video;
    }
  }
  return bestVideo;
}

function isUsableVideoRect(rect: DOMRect): boolean {
  return (
    rect.width >= MIN_VIDEO_SIZE &&
    rect.height >= MIN_VIDEO_SIZE &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function openDownloadDialog(video: HTMLVideoElement) {
  const existing = document.querySelector(`.${MODAL_CLASS}`);
  if (existing) {
    existing.remove();
  }

  const payload = createVideoElementPayload({
    mediaUrl: video.currentSrc || video.src,
    pageUrl: location.href,
    tabTitle: document.title,
  });

  const modal = document.createElement("div");
  modal.className = MODAL_CLASS;
  modal.innerHTML = `
    <form>
      <header>Download video</header>
      <label>
        <span>File name</span>
        <input name="fileName" autocomplete="off" />
      </label>
      <label>
        <span>Save location</span>
        <div class="folder-row">
          <input name="savePath" readonly placeholder="Choose folder" />
          <button type="button" name="choose">Choose...</button>
        </div>
      </label>
      <div class="actions">
        <button type="button" name="cancel">Cancel</button>
        <button type="submit" name="download">Download</button>
      </div>
    </form>
  `;

  const form = modal.querySelector("form") as HTMLFormElement;
  const fileNameInput = modal.querySelector('input[name="fileName"]') as HTMLInputElement;
  const savePathInput = modal.querySelector('input[name="savePath"]') as HTMLInputElement;
  const chooseButton = modal.querySelector('button[name="choose"]') as HTMLButtonElement;
  const cancelButton = modal.querySelector('button[name="cancel"]') as HTMLButtonElement;

  fileNameInput.value = stripExtension(payload.fileName === "detected-download" ? "video" : payload.fileName);
  chooseButton.addEventListener("click", () => void chooseSavePath(savePathInput));
  cancelButton.addEventListener("click", () => modal.remove());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendConfiguredVideo(payload, {
      fileName: fileNameInput.value,
      savePath: savePathInput.value,
      modal,
    });
  });

  document.documentElement.append(modal);
  fileNameInput.focus();
}

async function chooseSavePath(input: HTMLInputElement) {
  showToast("Opening folder picker...");
  const response = await chrome.runtime.sendMessage({
    type: "select-save-folder",
  }) as SelectSaveFolderResponse | undefined;
  if (response?.ok && response.savePath) {
    input.value = response.savePath;
    showToast("Folder selected");
    return;
  }
  showToast(response?.error ?? "No folder selected");
}

async function sendConfiguredVideo(
  payload: DetectedDownloadPayload,
  options: { fileName: string; savePath: string; modal: Element },
) {
  const fileName = stripExtension(options.fileName.trim());
  const savePath = options.savePath.trim();
  if (!fileName) {
    showToast("Enter a file name");
    return;
  }
  if (!savePath) {
    showToast("Choose a save location");
    return;
  }

  const downloadPayload: ConfiguredDownloadPayload = {
    ...payload,
    fileName,
    savePath,
  };

  const modalButton = options.modal.querySelector('button[name="download"]') as HTMLButtonElement | null;
  if (modalButton && sendingButtons.has(modalButton)) {
    return;
  }
  if (modalButton) {
    sendingButtons.add(modalButton);
    modalButton.disabled = true;
    modalButton.textContent = "Sending";
  }
  showToast("Sending to app...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "download-page-video",
      payload: downloadPayload,
    }) as DownloadPageVideoResponse | undefined;

    if (response?.ok) {
      showToast("Download sent to app");
      options.modal.remove();
      return;
    }

    const message = response?.error ?? "No response from Download Manager extension";
    showToast(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send video to Download Manager";
    showToast(message);
  } finally {
    if (modalButton) {
      modalButton.disabled = false;
      modalButton.textContent = "Download";
      sendingButtons.delete(modalButton);
    }
  }
}

function showToast(message: string) {
  let toast = document.querySelector(`.${TOAST_CLASS}`) as HTMLDivElement | null;
  if (!toast) {
    toast = document.createElement("div");
    toast.className = TOAST_CLASS;
    document.documentElement.append(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

function injectStyles() {
  if (document.getElementById("download-manager-video-button-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "download-manager-video-button-style";
  style.textContent = `
    .${BUTTON_CLASS} {
      position: fixed;
      z-index: 2147483647;
      height: 34px;
      padding: 0 12px;
      border: 1px solid rgba(0, 0, 0, 0.22);
      border-radius: 6px;
      background: #f7c948;
      color: #151515;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.26);
      font: 600 13px/34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      opacity: 0.96;
      pointer-events: auto;
      user-select: none;
    }

    .${BUTTON_CLASS}:hover {
      background: #ffd95a;
    }

    .${BUTTON_CLASS}:disabled {
      cursor: default;
      opacity: 0.78;
    }

    .${TOAST_CLASS} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px));
      padding: 10px 12px;
      border-radius: 6px;
      background: #151515;
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.28);
      font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .${MODAL_CLASS} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      background: rgba(0, 0, 0, 0.28);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .${MODAL_CLASS} form {
      width: min(420px, calc(100vw - 32px));
      padding: 16px;
      border-radius: 8px;
      background: #ffffff;
      color: #151515;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.32);
    }

    .${MODAL_CLASS} header {
      margin-bottom: 14px;
      font-size: 17px;
      font-weight: 700;
    }

    .${MODAL_CLASS} label {
      display: block;
      margin: 12px 0;
    }

    .${MODAL_CLASS} span {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: 650;
      color: #4a4a4a;
    }

    .${MODAL_CLASS} input {
      box-sizing: border-box;
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 1px solid #c8c8c8;
      border-radius: 6px;
      color: #151515;
      font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .${MODAL_CLASS} .folder-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }

    .${MODAL_CLASS} button {
      height: 34px;
      padding: 0 12px;
      border: 1px solid #c8c8c8;
      border-radius: 6px;
      background: #f4f4f4;
      color: #151515;
      font: 650 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }

    .${MODAL_CLASS} .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    .${MODAL_CLASS} button[name="download"] {
      border-color: #111111;
      background: #111111;
      color: #ffffff;
    }
  `;
  document.documentElement.append(style);
}

function createVideoElementPayload(input: {
  mediaUrl?: string | null;
  pageUrl: string;
  tabTitle: string;
}): DetectedDownloadPayload {
  const mediaUrl = input.mediaUrl?.trim();
  const url = mediaUrl && mediaUrl.startsWith("http") ? mediaUrl : input.pageUrl;
  return {
    url,
    pageUrl: input.pageUrl,
    fileName: getDetectedFileName(url),
    contentType: "video/mp4",
    tabTitle: input.tabTitle || "Untitled tab",
    detectedAt: new Date().toISOString(),
  };
}

function getDetectedFileName(value: string): string {
  try {
    const url = new URL(value);
    const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    const candidate = segments.at(-1)?.trim();
    if (candidate && candidate.includes(".") && !candidate.startsWith(".")) {
      return candidate.replace(/[\\/:*?"<>|]/g, "_");
    }
  } catch {
    // Invalid URLs are not sent from the overlay.
  }
  return "detected-download";
}

function stripExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, "").trim();
}

/*
 * Keep this file self-contained. Manifest V3 content scripts in Chromium-based
 * browsers are more reliable when they do not import generated chunks.
 */
