# Phase 1 Desktop Download

## Overview

Phase 1 builds the desktop app and manual direct URL downloader. All privileged work stays in Electron main:

- Filesystem access
- Folder picker
- Download execution
- SQLite access
- Progress broadcasting

The renderer is database-agnostic and filesystem-agnostic. It communicates through the preload IPC API only.

## App Structure

```text
apps/desktop
packages/downloader
packages/database
packages/shared
```

## IPC API

The preload bridge exposes:

- `addDownload(url, savePath)`
- `pauseDownload(id)`
- `resumeDownload(id)`
- `cancelDownload(id)`
- `retryDownload(id)`
- `getDownloads()`
- `onDownloadProgress(callback)`
- `selectSaveFolder()`

`selectSaveFolder()` is included so the renderer can request a safe Electron folder picker without direct filesystem access.

## Database

`packages/database` wraps `better-sqlite3`.

Rules:

- Use prepared statements.
- Initialize the schema on app startup.
- Store the database under Electron `app.getPath("userData")`.
- Persist status after meaningful state changes.
- Do not expose SQLite to the renderer.

Database file:

```text
downloads.sqlite
```

Stored fields:

- `id`
- `url`
- `file_name`
- `save_path`
- `total_size`
- `downloaded_size`
- `progress`
- `speed`
- `status`
- `error_message`
- `created_at`
- `updated_at`
- `completed_at`

## Why better-sqlite3

`better-sqlite3` was chosen because Phase 1 uses a local embedded database from the Electron main process. Its prepared-statement API is simple, predictable, and appropriate for small synchronous status/history updates.

The renderer never imports `better-sqlite3`. Only the database package uses it, and only main process code calls that package.

## Downloader

`packages/downloader` supports:

- HTTP URLs
- HTTPS URLs
- Direct file downloads
- Filename detection from `Content-Disposition`
- Filename fallback from the URL path
- File size detection from `Content-Length`
- `.part` temporary files
- Final rename only after successful completion
- Pause
- Resume when HTTP Range is supported
- Cancel
- Retry

Resume behavior:

- If a partial file exists and the server supports Range, resume continues from the partial size.
- If Range is not supported, resume fails with a clear error.
- Retry can restart from the beginning.

## Running

Install dependencies:

```bash
pnpm install
```

Start development app:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

Package macOS:

```bash
pnpm package:mac
```

Package Windows:

```bash
pnpm package:win
```

## Phase 1 Exclusions

Phase 1 does not include:

- Chrome extension
- Local server on `127.0.0.1:17891`
- `/health`
- `/detected`
- `yt-dlp`
- `ffmpeg`
- Video detection
- HLS/DASH
- DRM-related handling
