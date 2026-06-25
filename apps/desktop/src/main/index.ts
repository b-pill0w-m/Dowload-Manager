import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { OpenDialogOptions } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DownloadDatabase } from "@download-manager/database";
import { DownloadTask, detectFileName, isHttpDownloadUrl } from "@download-manager/downloader";
import {
  DRM_ERROR_MESSAGE,
  VideoDownloadProcess,
  analyzeFormats,
  buildFfmpegHlsDashCommand,
  buildVideoFileName,
  buildYtDlpDownloadCommand,
  defaultOutputExtension,
  defaultVideoFileName,
  detectMediaType,
  detectTool,
} from "@download-manager/video";
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
import { createLocalDetectionServer, type LocalDetectionServer } from "./local-server.js";
import { sendToWindowIfAlive } from "./window-events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let database: DownloadDatabase;
let localDetectionServer: LocalDetectionServer | null = null;
const tasks = new Map<string, DownloadTask>();
let toolStatus: ToolStatusMap = {
  ytdlp: { name: "yt-dlp", installed: false, version: null },
  ffmpeg: { name: "ffmpeg", installed: false, version: null },
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: "Download Manager",
    backgroundColor: "#f7f8fa",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function fail<T = never>(error: unknown): IpcResult<T> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function broadcastProgress(event: DownloadProgressEvent) {
  sendToWindowIfAlive(mainWindow, IPC_CHANNELS.downloadProgress, event);
}

function broadcastDetectedItem(item: DetectedDownloadItem) {
  sendToWindowIfAlive(mainWindow, IPC_CHANNELS.detectedItemReceived, item);
}

async function chooseSaveFolder(attachToMainWindow: boolean): Promise<string | null> {
  const options: OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
  };
  if (attachToMainWindow && mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  const pickerWindow = new BrowserWindow({
    width: 360,
    height: 120,
    show: false,
    title: "Choose save folder",
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    void pickerWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<!doctype html><meta charset='utf-8'><body style=\"margin:0;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fa;color:#1f2937;display:grid;place-items:center;height:100vh;text-align:center\"><div><strong>Choose save folder</strong><br><span style='color:#6b7280'>The folder picker will open here.</span></div></body>",
        ),
    );
    pickerWindow.show();
    pickerWindow.focus();
    const result = await dialog.showOpenDialog(pickerWindow, options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  } finally {
    if (!pickerWindow.isDestroyed()) {
      pickerWindow.destroy();
    }
    if (process.platform === "darwin") {
      app.hide();
    }
  }
}

function persistProgress(event: DownloadProgressEvent) {
  const completedAt = event.status === "completed" ? new Date().toISOString() : undefined;
  database.updateDownload(event.id, {
    fileName: event.fileName,
    savePath: event.savePath,
    totalSize: event.totalSize,
    downloadedSize: event.downloadedSize,
    progress: event.progress,
    speed: event.speed,
    status: event.status,
    errorMessage: event.errorMessage,
    stage: event.stage,
    toolUsed: event.toolUsed,
    completedAt,
  });
}

function attachTask(record: DownloadRecord, task: DownloadTask) {
  tasks.set(record.id, task);
  task.on("progress", (event) => {
    persistProgress(event);
    broadcastProgress(event);
  });
  task.on("status", (event) => {
    persistProgress(event);
    broadcastProgress(event);
  });
  task.on("error", () => {
    // Errors are represented by persisted status/progress events.
  });
}

function runTask(task: DownloadTask, action: Promise<void>) {
  void action.catch((error: unknown) => {
    const event = {
      id: task.id,
      url: task.url,
      fileName: task.fileName,
      savePath: task.finalPath,
      totalSize: task.totalSize,
      downloadedSize: task.downloadedSize,
      progress: task.totalSize ? Math.round((task.downloadedSize / task.totalSize) * 10000) / 100 : 0,
      speed: 0,
      status: "failed" as const,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    persistProgress(event);
    broadcastProgress(event);
  });
}

function startRecord(record: DownloadRecord) {
  const task = new DownloadTask({
    id: record.id,
    url: record.url,
    saveDirectory: record.savePath,
    fileName: record.fileName,
  });
  attachTask(record, task);
  runTask(task, task.start());
}

function createAndStartDownload(input: { url: string; savePath: string; fileName?: string }) {
  const mediaType = detectMediaType(input.url);
  const record = database.createDownload({
    url: input.url,
    fileName: input.fileName ?? detectFileName(input.url),
    savePath: input.savePath,
    downloadType: mediaType === "normal-file" ? "file" : "video",
    mediaType,
    outputExtension: defaultOutputExtension(mediaType, input.url),
    stage: mediaType === "normal-file" ? null : "downloading",
  });
  startRecord(record);
  return database.getDownload(record.id) ?? record;
}

function createAndStartVideoDownload(input: {
  url: string;
  saveDirectory: string;
  fileName?: string;
  selectedFormat?: string | null;
}) {
  const mediaType = detectMediaType(input.url);
  if (mediaType === "direct-video" || mediaType === "normal-file") {
    return createAndStartDownload({
      url: input.url,
      savePath: input.saveDirectory,
      fileName: input.fileName,
    });
  }
  if (!toolStatus.ytdlp.installed) {
    throw new Error("yt-dlp is required to download this video URL");
  }

  const outputExtension = defaultOutputExtension(mediaType, input.url);
  const fileName = buildVideoFileName({
    url: input.url,
    requestedName: input.fileName,
    extension: outputExtension,
  });
  const outputPath = join(input.saveDirectory, fileName);
  const record = database.createDownload({
    url: input.url,
    fileName,
    savePath: input.saveDirectory,
    downloadType: "video",
    mediaType,
    selectedFormat: input.selectedFormat ?? "best",
    outputExtension,
    toolUsed: "yt-dlp",
    stage: "analyzing",
  });
  runExternalVideoDownload(record, outputPath, input.selectedFormat ?? null);
  return record;
}

function runExternalVideoDownload(record: DownloadRecord, outputPath: string, selectedFormat: string | null) {
  database.updateDownload(record.id, {
    status: "downloading",
    stage: "downloading",
    toolUsed: "yt-dlp",
  });

  const ytdlp = new VideoDownloadProcess(
    buildYtDlpDownloadCommand({
      url: record.url,
      outputPath,
      formatId: selectedFormat && selectedFormat !== "best" ? selectedFormat : null,
    }),
    "yt-dlp",
  );

  let fallbackStarted = false;
  const startFfmpegFallback = () => {
    if (fallbackStarted || !toolStatus.ffmpeg.installed) {
      return false;
    }
    fallbackStarted = true;
    const ffmpeg = new VideoDownloadProcess(
      buildFfmpegHlsDashCommand({ url: record.url, outputPath }),
      "ffmpeg",
    );
    attachVideoProcess(record, ffmpeg);
    database.updateDownload(record.id, {
      toolUsed: "ffmpeg",
      stage: "downloading",
      errorMessage: null,
    });
    ffmpeg.start();
    return true;
  };

  attachVideoProcess(record, ytdlp, startFfmpegFallback);
  ytdlp.start();
}

function attachVideoProcess(
  record: DownloadRecord,
  process: VideoDownloadProcess,
  fallback?: () => boolean,
) {
  process.on("progress", (event) => {
    const updated = database.updateDownload(record.id, {
      progress: event.progress,
      speed: event.speed,
      status: "downloading",
      stage: event.stage,
      toolUsed: event.toolUsed,
      errorMessage: event.message,
    });
    broadcastProgress(downloadRecordToProgress(updated));
  });
  process.on("done", () => {
    const updated = database.updateDownload(record.id, {
      progress: 100,
      status: "completed",
      stage: "completed",
      speed: 0,
      errorMessage: null,
      completedAt: new Date().toISOString(),
    });
    broadcastProgress(downloadRecordToProgress(updated));
  });
  process.on("error", (error) => {
    if (error.message !== DRM_ERROR_MESSAGE && fallback?.()) {
      return;
    }
    const updated = database.updateDownload(record.id, {
      status: "failed",
      stage: "failed",
      speed: 0,
      errorMessage: error.message === DRM_ERROR_MESSAGE ? DRM_ERROR_MESSAGE : error.message,
    });
    broadcastProgress(downloadRecordToProgress(updated));
  });
}

function downloadRecordToProgress(record: DownloadRecord): DownloadProgressEvent {
  return {
    id: record.id,
    url: record.url,
    fileName: record.fileName,
    savePath: record.savePath,
    totalSize: record.totalSize,
    downloadedSize: record.downloadedSize,
    progress: record.progress,
    speed: record.speed,
    status: record.status,
    errorMessage: record.errorMessage,
    stage: record.stage,
    toolUsed: record.toolUsed,
  };
}

function registerIpc() {
  ipcMain.handle(IPC_CHANNELS.selectSaveFolder, async (): Promise<IpcResult<string | null>> => {
    try {
      return ok(await chooseSaveFolder(true));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDownloads, (): IpcResult<DownloadRecord[]> => {
    try {
      return ok(database.getDownloads());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getToolStatus, (): IpcResult<ToolStatusMap> => {
    return ok(toolStatus);
  });

  ipcMain.handle(IPC_CHANNELS.addDownload, async (_event, input: AddDownloadRequest): Promise<IpcResult<DownloadRecord>> => {
    try {
      if (!isHttpDownloadUrl(input.url)) {
        throw new Error("Only HTTP and HTTPS URLs are supported");
      }
      if (!input.savePath) {
        throw new Error("Choose a save folder before starting a download");
      }

      const record = createAndStartVideoDownload({
        url: input.url,
        saveDirectory: input.savePath,
      });
      return ok(record);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.getDetectedItems, (): IpcResult<DetectedDownloadItem[]> => {
    try {
      return ok(database.getDetectedItems());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.ignoreDetectedItem, (_event, id: string): IpcResult<DetectedDownloadItem> => {
    try {
      return ok(database.ignoreDetectedItem(id));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.downloadDetectedItem, (_event, id: string): IpcResult<DownloadRecord> => {
    try {
      const item = database.getDetectedItem(id);
      if (!item) {
        throw new Error(`Detected item ${id} was not found`);
      }
      if (item.status === "ignored") {
        throw new Error("Ignored detected items cannot be downloaded");
      }
      const record = createAndStartVideoDownload({
        url: item.url,
        fileName: item.fileName,
        saveDirectory: app.getPath("downloads"),
      });
      const updated = database.markDetectedItemDownloaded(id);
      broadcastDetectedItem(updated);
      return ok(record);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.analyzeDetectedItemFormats, async (_event, id: string): Promise<IpcResult<FormatOption[]>> => {
    try {
      const item = database.getDetectedItem(id);
      if (!item) {
        throw new Error(`Detected item ${id} was not found`);
      }
      if (detectMediaType(item.url) === "direct-video" || detectMediaType(item.url) === "normal-file") {
        return ok([]);
      }
      if (!toolStatus.ytdlp.installed) {
        throw new Error("yt-dlp is required to analyze video formats");
      }
      return ok(await analyzeFormats(item.url));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.pauseDownload, (_event, id: string): IpcResult<DownloadRecord> => {
    try {
      tasks.get(id)?.pause();
      const record = database.getDownload(id);
      if (!record) throw new Error(`Download ${id} was not found`);
      return ok(record);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.resumeDownload, async (_event, id: string): Promise<IpcResult<DownloadRecord>> => {
    try {
      const record = database.getDownload(id);
      if (!record) throw new Error(`Download ${id} was not found`);
      let task = tasks.get(id);
      if (!task) {
        task = new DownloadTask({
          id: record.id,
          url: record.url,
          saveDirectory: record.savePath,
          fileName: record.fileName,
        });
        attachTask(record, task);
      }
      runTask(task, task.resume());
      return ok(database.getDownload(id) ?? record);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.cancelDownload, (_event, id: string): IpcResult<DownloadRecord> => {
    try {
      tasks.get(id)?.cancel();
      const record = database.getDownload(id);
      if (!record) throw new Error(`Download ${id} was not found`);
      return ok(record);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.retryDownload, async (_event, id: string): Promise<IpcResult<DownloadRecord>> => {
    try {
      const record = database.getDownload(id);
      if (!record) throw new Error(`Download ${id} was not found`);
      let task = tasks.get(id);
      if (!task) {
        task = new DownloadTask({
          id: record.id,
          url: record.url,
          saveDirectory: record.savePath,
          fileName: record.fileName,
        });
        attachTask(record, task);
      }
      runTask(task, task.retry());
      return ok(database.getDownload(id) ?? record);
    } catch (error) {
      return fail(error);
    }
  });
}

app.whenReady().then(async () => {
  database = new DownloadDatabase(join(app.getPath("userData"), "downloads.sqlite"));
  const [ytdlp, ffmpeg] = await Promise.all([detectTool("yt-dlp"), detectTool("ffmpeg")]);
  toolStatus = { ytdlp, ffmpeg };
  registerIpc();
  localDetectionServer = createLocalDetectionServer({
    database,
    onDetectedItem: broadcastDetectedItem,
    onDownloadRequest: (payload) => {
      const record = createAndStartVideoDownload({
        url: payload.url,
        fileName: payload.fileName,
        saveDirectory: payload.savePath,
      });
      broadcastProgress(downloadRecordToProgress(record));
      return {
        id: record.id,
        url: record.url,
        fileName: record.fileName,
      };
    },
    onSelectSaveFolder: ({ attachToMainWindow }) => chooseSaveFolder(attachToMainWindow),
  });
  void localDetectionServer.listen().catch((error: unknown) => {
    console.error("Failed to start local detection server", error);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void localDetectionServer?.close();
  database?.close();
});
