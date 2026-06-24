import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  DetectedDownloadItem,
  DownloadProgressEvent,
  DownloadRecord,
  DownloadStatus,
  FormatOption,
  ToolStatusMap,
} from "@download-manager/shared";
import "./styles.css";

type Page = "downloads" | "detected" | "history" | "settings";

function App() {
  const [page, setPage] = useState<Page>("downloads");
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [detectedItems, setDetectedItems] = useState<DetectedDownloadItem[]>([]);
  const [formatOptions, setFormatOptions] = useState<Record<string, FormatOption[]>>({});
  const [toolStatus, setToolStatus] = useState<ToolStatusMap | null>(null);
  const [url, setUrl] = useState("");
  const [saveFolder, setSaveFolder] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshDownloads();
    void refreshDetectedItems();
    void refreshToolStatus();
    const removeDownloadListener = window.downloadManager.onDownloadProgress((event) => {
      setDownloads((current) => mergeProgress(current, event));
    });
    const removeDetectedListener = window.downloadManager.onDetectedItemReceived((item) => {
      setDetectedItems((current) => upsertDetectedItem(current, item));
    });
    return () => {
      removeDownloadListener();
      removeDetectedListener();
    };
  }, []);

  async function refreshDownloads() {
    const result = await window.downloadManager.getDownloads();
    if (result.ok) {
      setDownloads(result.data);
    } else {
      setMessage(result.error);
    }
  }

  async function refreshDetectedItems() {
    const result = await window.downloadManager.getDetectedItems();
    if (result.ok) {
      setDetectedItems(result.data);
    } else {
      setMessage(result.error);
    }
  }

  async function refreshToolStatus() {
    const result = await window.downloadManager.getToolStatus();
    if (result.ok) {
      setToolStatus(result.data);
    } else {
      setMessage(result.error);
    }
  }

  async function chooseFolder() {
    const result = await window.downloadManager.selectSaveFolder();
    if (result.ok) {
      setSaveFolder(result.data ?? saveFolder);
    } else {
      setMessage(result.error ?? "Unable to choose folder");
    }
  }

  async function startDownload() {
    setMessage("");
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !saveFolder) {
      setMessage("Enter a URL and choose a save folder.");
      return;
    }

    const result = await window.downloadManager.addDownload(trimmedUrl, saveFolder);
    if (result.ok) {
      setDownloads((current) => upsertDownload(current, result.data));
      setUrl("");
    } else {
      setMessage(result.error);
    }
  }

  async function control(action: "pause" | "resume" | "cancel" | "retry", id: string) {
    setMessage("");
    const call = {
      pause: window.downloadManager.pauseDownload,
      resume: window.downloadManager.resumeDownload,
      cancel: window.downloadManager.cancelDownload,
      retry: window.downloadManager.retryDownload,
    }[action];

    const result = await call(id);
    if (result.ok) {
      setDownloads((current) => upsertDownload(current, result.data));
    } else {
      setMessage(result.error);
    }
  }

  async function ignoreDetectedItem(id: string) {
    setMessage("");
    const result = await window.downloadManager.ignoreDetectedItem(id);
    if (result.ok) {
      setDetectedItems((current) => upsertDetectedItem(current, result.data));
    } else {
      setMessage(result.error);
    }
  }

  async function downloadDetectedItem(id: string) {
    setMessage("");
    const result = await window.downloadManager.downloadDetectedItem(id);
    if (result.ok) {
      setDownloads((current) => upsertDownload(current, result.data));
      await refreshDetectedItems();
      setPage("downloads");
    } else {
      setMessage(result.error);
    }
  }

  async function analyzeDetectedItem(id: string) {
    setMessage("");
    const result = await window.downloadManager.analyzeDetectedItemFormats(id);
    if (result.ok) {
      setFormatOptions((current) => ({ ...current, [id]: result.data }));
    } else {
      setMessage(result.error);
    }
  }

  const activeDownloads = useMemo(
    () => downloads.filter((download) => download.status !== "completed" && download.status !== "canceled"),
    [downloads],
  );
  const historyDownloads = useMemo(
    () => downloads.filter((download) => download.status === "completed" || download.status === "canceled" || download.status === "failed"),
    [downloads],
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">Download Manager</div>
        <nav>
          <NavButton active={page === "downloads"} onClick={() => setPage("downloads")}>Downloads</NavButton>
          <NavButton active={page === "detected"} onClick={() => setPage("detected")}>Detected Media</NavButton>
          <NavButton active={page === "history"} onClick={() => setPage("history")}>History</NavButton>
          <NavButton active={page === "settings"} onClick={() => setPage("settings")}>Settings</NavButton>
        </nav>
      </aside>

      <section className="content">
        {page === "downloads" && (
          <>
            <header className="toolbar">
              <div>
                <h1>Downloads</h1>
                <p>Paste a direct HTTP or HTTPS file URL.</p>
              </div>
            </header>

            <section className="add-panel" aria-label="Add download">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/file.zip"
                aria-label="Download URL"
              />
              <div className="folder-row">
                <input value={saveFolder} readOnly placeholder="Choose a save folder" aria-label="Save folder" />
                <button type="button" className="secondary" onClick={chooseFolder}>Choose</button>
              </div>
              <button type="button" className="primary" onClick={startDownload}>Start Download</button>
            </section>

            {message && <div className="notice">{message}</div>}
            <DownloadsTable downloads={activeDownloads} onControl={control} emptyText="No active downloads yet." />
          </>
        )}

        {page === "history" && (
          <>
            <header className="toolbar">
              <div>
                <h1>History</h1>
                <p>Completed, failed, and canceled downloads saved in SQLite.</p>
              </div>
              <button type="button" className="secondary" onClick={() => void refreshDownloads()}>Refresh</button>
            </header>
            <DownloadsTable downloads={historyDownloads} onControl={control} emptyText="No history yet." />
          </>
        )}

        {page === "detected" && (
          <>
            <header className="toolbar">
              <div>
                <h1>Detected Media</h1>
                <p>Items sent from the Chrome extension. Downloads start only when you click Download.</p>
              </div>
              <button type="button" className="secondary" onClick={() => void refreshDetectedItems()}>Refresh</button>
            </header>
            {message && <div className="notice">{message}</div>}
            <DetectedItemsTable
              items={detectedItems}
              formatOptions={formatOptions}
              onAnalyze={analyzeDetectedItem}
              onDownload={downloadDetectedItem}
              onIgnore={ignoreDetectedItem}
            />
          </>
        )}

        {page === "settings" && (
          <>
            <header className="toolbar">
              <div>
                <h1>Settings</h1>
                <p>Phase 1 keeps privileged settings in the main process.</p>
              </div>
            </header>
            <section className="settings-grid">
              <div className="setting-row">
                <span>yt-dlp</span>
                <strong>{formatToolStatus(toolStatus?.ytdlp)}</strong>
              </div>
              <div className="setting-row">
                <span>ffmpeg</span>
                <strong>{formatToolStatus(toolStatus?.ffmpeg)}</strong>
              </div>
              <div className="setting-row">
                <span>Default save folder</span>
                <strong>{saveFolder || "Not selected"}</strong>
              </div>
              <div className="setting-row">
                <span>Database</span>
                <strong>Stored under Electron userData</strong>
              </div>
              <div className="setting-row">
                <span>Supported URLs</span>
                <strong>HTTP and HTTPS direct files</strong>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function NavButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={props.active ? "nav active" : "nav"} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function DownloadsTable(props: {
  downloads: DownloadRecord[];
  emptyText: string;
  onControl: (action: "pause" | "resume" | "cancel" | "retry", id: string) => Promise<void>;
}) {
  if (props.downloads.length === 0) {
    return <div className="empty">{props.emptyText}</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File name</th>
            <th>URL</th>
            <th>Size</th>
            <th>Progress</th>
            <th>Speed</th>
            <th>Status</th>
            <th>Stage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.downloads.map((download) => (
            <tr key={download.id}>
              <td className="file-cell" title={download.fileName}>{download.fileName}</td>
              <td className="url-cell" title={download.url}>{download.url}</td>
              <td>{formatBytes(download.totalSize)}</td>
              <td>
                <div className="progress-cell">
                  <progress value={download.progress} max={100} />
                  <span>{formatProgress(download.progress, download.status)}</span>
                </div>
              </td>
              <td>{formatSpeed(download.speed)}</td>
              <td><StatusBadge status={download.status} /></td>
              <td>{download.stage ?? download.toolUsed ?? "-"}</td>
              <td>
                <div className="actions">
                  {download.status === "downloading" && (
                    <button type="button" onClick={() => void props.onControl("pause", download.id)}>Pause</button>
                  )}
                  {download.status === "paused" && (
                    <button type="button" onClick={() => void props.onControl("resume", download.id)}>Resume</button>
                  )}
                  {(download.status === "failed" || download.status === "canceled") && (
                    <button type="button" onClick={() => void props.onControl("retry", download.id)}>Retry</button>
                  )}
                  {download.status !== "completed" && download.status !== "canceled" && (
                    <button type="button" onClick={() => void props.onControl("cancel", download.id)}>Cancel</button>
                  )}
                </div>
                {download.errorMessage && <div className="row-error">{download.errorMessage}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetectedItemsTable(props: {
  items: DetectedDownloadItem[];
  formatOptions: Record<string, FormatOption[]>;
  onAnalyze: (id: string) => Promise<void>;
  onDownload: (id: string) => Promise<void>;
  onIgnore: (id: string) => Promise<void>;
}) {
  if (props.items.length === 0) {
    return <div className="empty">No detected media yet.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File name</th>
            <th>Tab title</th>
            <th>Page URL</th>
            <th>Source URL</th>
            <th>Content type</th>
            <th>Media type</th>
            <th>Formats</th>
            <th>Detected</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id}>
              <td className="file-cell" title={item.fileName}>{item.fileName}</td>
              <td className="file-cell" title={item.tabTitle}>{item.tabTitle}</td>
              <td className="url-cell" title={item.pageUrl}>{item.pageUrl}</td>
              <td className="url-cell" title={item.url}>{item.url}</td>
              <td>{item.contentType}</td>
              <td><span className={`status ${item.mediaType}`}>{item.mediaType}</span></td>
              <td><FormatOptions options={props.formatOptions[item.id] ?? []} /></td>
              <td>{formatDate(item.detectedAt)}</td>
              <td><span className={`status ${item.status}`}>{item.status}</span></td>
              <td>
                <div className="actions">
                  {item.status === "new" && (
                    <>
                      {(item.mediaType === "hls" || item.mediaType === "dash") && (
                        <button type="button" onClick={() => void props.onAnalyze(item.id)}>Analyze formats</button>
                      )}
                      <button type="button" onClick={() => void props.onDownload(item.id)}>Download</button>
                      <button type="button" onClick={() => void props.onIgnore(item.id)}>Ignore</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: DownloadStatus }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function FormatOptions({ options }: { options: FormatOption[] }) {
  if (options.length === 0) {
    return <span className="muted">Best</span>;
  }
  return (
    <div className="format-list">
      {options.slice(0, 3).map((option) => (
        <span key={option.formatId}>
          {option.label} · {option.extension}
          {option.estimatedSize ? ` · ${formatBytes(option.estimatedSize)}` : ""}
        </span>
      ))}
    </div>
  );
}

function upsertDownload(downloads: DownloadRecord[], next: DownloadRecord): DownloadRecord[] {
  const found = downloads.some((download) => download.id === next.id);
  if (!found) {
    return [next, ...downloads];
  }
  return downloads.map((download) => (download.id === next.id ? next : download));
}

function upsertDetectedItem(items: DetectedDownloadItem[], next: DetectedDownloadItem): DetectedDownloadItem[] {
  const found = items.some((item) => item.id === next.id);
  if (!found) {
    return [next, ...items];
  }
  return items.map((item) => (item.id === next.id ? next : item));
}

function mergeProgress(downloads: DownloadRecord[], event: DownloadProgressEvent): DownloadRecord[] {
  const existing = downloads.find((download) => download.id === event.id);
  const now = new Date().toISOString();
  const next: DownloadRecord = {
    id: event.id,
    url: event.url,
    fileName: event.fileName,
    savePath: event.savePath,
    totalSize: event.totalSize,
    downloadedSize: event.downloadedSize,
    progress: event.progress,
    speed: event.speed,
    status: event.status,
    errorMessage: event.errorMessage,
    downloadType: existing?.downloadType ?? "file",
    mediaType: existing?.mediaType ?? "normal-file",
    selectedFormat: existing?.selectedFormat ?? null,
    outputExtension: existing?.outputExtension ?? null,
    toolUsed: event.toolUsed ?? existing?.toolUsed ?? null,
    stage: event.stage ?? existing?.stage ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: event.status === "completed" ? now : existing?.completedAt ?? null,
  };
  return upsertDownload(downloads, next);
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) {
    return "Unknown";
  }
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(value: number): string {
  if (!value) {
    return "-";
  }
  return `${formatBytes(value)}/s`;
}

function formatProgress(progress: number, status: DownloadStatus): string {
  if (status === "completed") {
    return "100%";
  }
  return `${Math.round(progress)}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatToolStatus(status: ToolStatusMap[keyof ToolStatusMap] | undefined): string {
  if (!status) {
    return "Checking...";
  }
  return status.installed ? `installed${status.version ? ` (${status.version})` : ""}` : "missing";
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
