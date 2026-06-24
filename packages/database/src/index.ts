import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type {
  CreateDownloadInput,
  DetectedDownloadItem,
  DetectedDownloadPayload,
  DetectedItemStatus,
  DownloadType,
  MediaType,
  DownloadRecord,
  DownloadStatus,
  ToolName,
  UpdateDownloadInput,
  VideoStage,
} from "@download-manager/shared";

interface DownloadRow {
  id: string;
  url: string;
  file_name: string;
  save_path: string;
  total_size: number | null;
  downloaded_size: number;
  progress: number;
  speed: number;
  status: DownloadStatus;
  error_message: string | null;
  download_type: DownloadType;
  media_type: MediaType;
  selected_format: string | null;
  output_extension: string | null;
  tool_used: ToolName | null;
  stage: VideoStage | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface DetectedItemRow {
  id: string;
  url: string;
  page_url: string;
  file_name: string;
  content_type: string;
  tab_title: string;
  status: DetectedItemStatus;
  detected_at: string;
  created_at: string;
  updated_at: string;
  ignored_at: string | null;
  downloaded_at: string | null;
  media_type: MediaType;
}

export class DownloadDatabase {
  readonly path: string;
  readonly db: Database.Database;

  constructor(databasePath: string) {
    this.path = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        file_name TEXT NOT NULL,
        save_path TEXT NOT NULL,
        total_size INTEGER,
        downloaded_size INTEGER NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0,
        speed INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS detected_items (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        page_url TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        tab_title TEXT NOT NULL,
        status TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ignored_at TEXT,
        downloaded_at TEXT
      );

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, datetime('now'));

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (2, datetime('now'));

      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (3, datetime('now'));
    `);
    this.addColumn("downloads", "download_type TEXT NOT NULL DEFAULT 'file'");
    this.addColumn("downloads", "media_type TEXT NOT NULL DEFAULT 'normal-file'");
    this.addColumn("downloads", "selected_format TEXT");
    this.addColumn("downloads", "output_extension TEXT");
    this.addColumn("downloads", "tool_used TEXT");
    this.addColumn("downloads", "stage TEXT");
    this.addColumn("detected_items", "media_type TEXT NOT NULL DEFAULT 'normal-file'");
  }

  private addColumn(tableName: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("duplicate column")) {
        return;
      }
      throw error;
    }
  }

  listTables(): string[] {
    return this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
  }

  createDownload(input: CreateDownloadInput): DownloadRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: DownloadRecord = {
      id,
      url: input.url,
      fileName: input.fileName,
      savePath: input.savePath,
      totalSize: input.totalSize ?? null,
      downloadedSize: 0,
      progress: 0,
      speed: 0,
      status: "queued",
      errorMessage: null,
      downloadType: input.downloadType ?? "file",
      mediaType: input.mediaType ?? "normal-file",
      selectedFormat: input.selectedFormat ?? null,
      outputExtension: input.outputExtension ?? null,
      toolUsed: input.toolUsed ?? null,
      stage: input.stage ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.db
      .prepare(`
        INSERT INTO downloads (
          id, url, file_name, save_path, total_size, downloaded_size,
          progress, speed, status, error_message, download_type, media_type,
          selected_format, output_extension, tool_used, stage,
          created_at, updated_at, completed_at
        )
        VALUES (
          @id, @url, @fileName, @savePath, @totalSize, @downloadedSize,
          @progress, @speed, @status, @errorMessage, @downloadType, @mediaType,
          @selectedFormat, @outputExtension, @toolUsed, @stage,
          @createdAt, @updatedAt, @completedAt
        )
      `)
      .run(record);

    return record;
  }

  getDownload(id: string): DownloadRecord | null {
    const row = this.db
      .prepare("SELECT * FROM downloads WHERE id = ?")
      .get(id) as DownloadRow | undefined;
    return row ? mapDownload(row) : null;
  }

  getDownloads(): DownloadRecord[] {
    return this.db
      .prepare("SELECT * FROM downloads ORDER BY created_at DESC")
      .all()
      .map((row) => mapDownload(row as DownloadRow));
  }

  updateDownload(id: string, input: UpdateDownloadInput): DownloadRecord {
    const current = this.getDownload(id);
    if (!current) {
      throw new Error(`Download ${id} was not found`);
    }

    const next: DownloadRecord = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(`
        UPDATE downloads
        SET
          file_name = @fileName,
          save_path = @savePath,
          total_size = @totalSize,
          downloaded_size = @downloadedSize,
          progress = @progress,
          speed = @speed,
          status = @status,
          error_message = @errorMessage,
          download_type = @downloadType,
          media_type = @mediaType,
          selected_format = @selectedFormat,
          output_extension = @outputExtension,
          tool_used = @toolUsed,
          stage = @stage,
          updated_at = @updatedAt,
          completed_at = @completedAt
        WHERE id = @id
      `)
      .run(next);

    return next;
  }

  createDetectedItem(input: DetectedDownloadPayload): DetectedDownloadItem {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT * FROM detected_items WHERE url = ? AND page_url = ? AND status = 'new'")
      .get(input.url, input.pageUrl) as DetectedItemRow | undefined;
    if (existing) {
      return mapDetectedItem(existing);
    }

    const item: DetectedDownloadItem = {
      id: crypto.randomUUID(),
      url: input.url,
      pageUrl: input.pageUrl,
      fileName: input.fileName,
      contentType: input.contentType,
      tabTitle: input.tabTitle,
      status: "new",
      detectedAt: input.detectedAt,
      createdAt: now,
      updatedAt: now,
      ignoredAt: null,
      downloadedAt: null,
      mediaType: inferMediaType(input.url),
    };

    this.db
      .prepare(`
        INSERT INTO detected_items (
          id, url, page_url, file_name, content_type, tab_title, status,
          detected_at, created_at, updated_at, ignored_at, downloaded_at, media_type
        )
        VALUES (
          @id, @url, @pageUrl, @fileName, @contentType, @tabTitle, @status,
          @detectedAt, @createdAt, @updatedAt, @ignoredAt, @downloadedAt, @mediaType
        )
      `)
      .run(item);

    return item;
  }

  getDetectedItems(): DetectedDownloadItem[] {
    return this.db
      .prepare("SELECT * FROM detected_items ORDER BY detected_at DESC, created_at DESC")
      .all()
      .map((row) => mapDetectedItem(row as DetectedItemRow));
  }

  getDetectedItem(id: string): DetectedDownloadItem | null {
    const row = this.db
      .prepare("SELECT * FROM detected_items WHERE id = ?")
      .get(id) as DetectedItemRow | undefined;
    return row ? mapDetectedItem(row) : null;
  }

  ignoreDetectedItem(id: string): DetectedDownloadItem {
    return this.updateDetectedItemStatus(id, "ignored", {
      ignoredAt: new Date().toISOString(),
    });
  }

  markDetectedItemDownloaded(id: string): DetectedDownloadItem {
    return this.updateDetectedItemStatus(id, "downloaded", {
      downloadedAt: new Date().toISOString(),
    });
  }

  private updateDetectedItemStatus(
    id: string,
    status: DetectedItemStatus,
    timestamps: { ignoredAt?: string | null; downloadedAt?: string | null },
  ): DetectedDownloadItem {
    const current = this.getDetectedItem(id);
    if (!current) {
      throw new Error(`Detected item ${id} was not found`);
    }
    const next: DetectedDownloadItem = {
      ...current,
      status,
      ignoredAt: timestamps.ignoredAt ?? current.ignoredAt,
      downloadedAt: timestamps.downloadedAt ?? current.downloadedAt,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(`
        UPDATE detected_items
        SET
          status = @status,
          updated_at = @updatedAt,
          ignored_at = @ignoredAt,
          downloaded_at = @downloadedAt
        WHERE id = @id
      `)
      .run(next);

    return next;
  }

  close(): void {
    this.db.close();
  }
}

function mapDownload(row: DownloadRow): DownloadRecord {
  return {
    id: row.id,
    url: row.url,
    fileName: row.file_name,
    savePath: row.save_path,
    totalSize: row.total_size,
    downloadedSize: row.downloaded_size,
    progress: row.progress,
    speed: row.speed,
    status: row.status,
    errorMessage: row.error_message,
    downloadType: row.download_type ?? "file",
    mediaType: row.media_type ?? "normal-file",
    selectedFormat: row.selected_format,
    outputExtension: row.output_extension,
    toolUsed: row.tool_used,
    stage: row.stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapDetectedItem(row: DetectedItemRow): DetectedDownloadItem {
  return {
    id: row.id,
    url: row.url,
    pageUrl: row.page_url,
    fileName: row.file_name,
    contentType: row.content_type,
    tabTitle: row.tab_title,
    status: row.status,
    detectedAt: row.detected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ignoredAt: row.ignored_at,
    downloadedAt: row.downloaded_at,
    mediaType: row.media_type ?? "normal-file",
  };
}

function inferMediaType(urlValue: string): MediaType {
  try {
    const pathname = new URL(urlValue).pathname.toLowerCase();
    if (pathname.endsWith(".m3u8")) return "hls";
    if (pathname.endsWith(".mpd")) return "dash";
    if (pathname.endsWith(".mp4") || pathname.endsWith(".webm")) return "direct-video";
  } catch {
    // Keep normal-file fallback.
  }
  return "normal-file";
}
