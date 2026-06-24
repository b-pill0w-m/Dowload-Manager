import type { DownloadManagerApi } from "../preload/index.js";

declare global {
  interface Window {
    downloadManager: DownloadManagerApi;
  }
}
