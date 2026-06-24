import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AddDownloadRequest,
  type DetectedDownloadItem,
  type DownloadProgressEvent,
  type DownloadRecord,
  type FormatOption,
  type IpcResult,
  type ToolStatusMap,
} from "@download-manager/shared";

const api = {
  addDownload(url: string, savePath: string): Promise<IpcResult<DownloadRecord>> {
    const input: AddDownloadRequest = { url, savePath };
    return ipcRenderer.invoke(IPC_CHANNELS.addDownload, input);
  },
  pauseDownload(id: string): Promise<IpcResult<DownloadRecord>> {
    return ipcRenderer.invoke(IPC_CHANNELS.pauseDownload, id);
  },
  resumeDownload(id: string): Promise<IpcResult<DownloadRecord>> {
    return ipcRenderer.invoke(IPC_CHANNELS.resumeDownload, id);
  },
  cancelDownload(id: string): Promise<IpcResult<DownloadRecord>> {
    return ipcRenderer.invoke(IPC_CHANNELS.cancelDownload, id);
  },
  retryDownload(id: string): Promise<IpcResult<DownloadRecord>> {
    return ipcRenderer.invoke(IPC_CHANNELS.retryDownload, id);
  },
  getDownloads(): Promise<IpcResult<DownloadRecord[]>> {
    return ipcRenderer.invoke(IPC_CHANNELS.getDownloads);
  },
  getToolStatus(): Promise<IpcResult<ToolStatusMap>> {
    return ipcRenderer.invoke(IPC_CHANNELS.getToolStatus);
  },
  getDetectedItems(): Promise<IpcResult<DetectedDownloadItem[]>> {
    return ipcRenderer.invoke(IPC_CHANNELS.getDetectedItems);
  },
  analyzeDetectedItemFormats(id: string): Promise<IpcResult<FormatOption[]>> {
    return ipcRenderer.invoke(IPC_CHANNELS.analyzeDetectedItemFormats, id);
  },
  ignoreDetectedItem(id: string): Promise<IpcResult<DetectedDownloadItem>> {
    return ipcRenderer.invoke(IPC_CHANNELS.ignoreDetectedItem, id);
  },
  downloadDetectedItem(id: string): Promise<IpcResult<DownloadRecord>> {
    return ipcRenderer.invoke(IPC_CHANNELS.downloadDetectedItem, id);
  },
  selectSaveFolder(): Promise<IpcResult<string | null>> {
    return ipcRenderer.invoke(IPC_CHANNELS.selectSaveFolder);
  },
  onDownloadProgress(callback: (event: DownloadProgressEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DownloadProgressEvent) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.downloadProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.downloadProgress, listener);
  },
  onDetectedItemReceived(callback: (item: DetectedDownloadItem) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DetectedDownloadItem) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.detectedItemReceived, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.detectedItemReceived, listener);
  },
};

contextBridge.exposeInMainWorld("downloadManager", api);

export type DownloadManagerApi = typeof api;
