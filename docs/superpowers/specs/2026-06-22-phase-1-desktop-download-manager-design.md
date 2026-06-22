# Phase 1 Desktop Download Manager Design

Date: 2026-06-22

## Goal

Build Phase 1 of a cross-platform desktop download manager for macOS and Windows.

Phase 1 includes only:

- Electron desktop app
- React + TypeScript + Vite renderer
- Manual HTTP/HTTPS direct file URL downloads
- Node.js download core
- SQLite download history and status persistence
- Safe Electron IPC between renderer and main process

Phase 1 intentionally excludes browser extension integration, video detection, and media extraction.

## Approved Project Structure

```text
download-manager/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   └── renderer/
│       ├── package.json
│       └── electron-builder.yml
├── packages/
│   ├── downloader/
│   ├── shared/
│   └── database/
├── package.json
├── pnpm-workspace.yaml
├── README.md
└── docs/
    ├── PHASE_1_DESKTOP_DOWNLOAD.md
    └── superpowers/
        └── specs/
            └── 2026-06-22-phase-1-desktop-download-manager-design.md
```

## Architecture

Use a package-based main-process architecture.

The Electron main process owns all privileged behavior:

- Filesystem access
- SQLite access
- Download execution
- Folder picker
- Progress broadcasting

The renderer remains clean and unprivileged:

- No direct SQLite access
- No direct filesystem access
- No direct Node.js downloader access
- No direct use of `better-sqlite3`
- No direct use of downloader package APIs
- Communicates only through the preload IPC API

The preload script exposes a minimal safe bridge from renderer to main. The main process validates IPC inputs, calls the database and downloader packages, persists state changes, and broadcasts progress updates back to renderer windows.

## Packages

### `packages/shared`

Contains shared TypeScript types only.

Primary types:

- `DownloadStatus`
- `DownloadRecord`
- `DownloadProgressEvent`
- IPC request and response payloads

Supported statuses:

- `queued`
- `downloading`
- `paused`
- `completed`
- `failed`
- `canceled`

### `packages/database`

Wraps all SQLite operations.

Implementation requirements:

- Use `better-sqlite3`.
- Use `better-sqlite3` only from Electron main or this database package when called by Electron main.
- Store the database file under Electron `app.getPath("userData")`.
- Recommended filename: `downloads.sqlite`.
- Use prepared statements for all reads and writes.
- Initialize schema on app startup.
- Include a simple migration path using a `schema_migrations` table or `PRAGMA user_version`.
- Persist download status after every meaningful state change.
- Do not expose database internals to the renderer.

The database stores:

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

Meaningful state changes include:

- Download created
- Queued
- Started
- Progress updated
- Paused
- Resumed
- Completed
- Failed
- Canceled
- Retried
- Error message changed
- Final save path or detected file name changed

### `packages/downloader`

Contains the Node.js download core.

Supported inputs:

- HTTP direct file URLs
- HTTPS direct file URLs

Out of scope for this package in Phase 1:

- Browser integration
- Video detection
- HLS/DASH
- DRM-related handling
- `yt-dlp`
- `ffmpeg`

Downloader behavior:

- Validate URL before starting.
- Reject unsupported protocols with a clear error.
- Detect file name from `Content-Disposition` first.
- Fall back to file name from URL path.
- Use a safe fallback file name when neither source produces a usable name.
- Detect file size from `Content-Length`.
- Detect resume support from HTTP Range behavior.
- Write active downloads to `.part` files.
- Finalize by renaming/moving only after successful completion.
- Emit progress events with downloaded bytes, total bytes when known, progress percentage, speed, and status.
- Calculate speed from byte deltas over time.
- Handle network errors and surface clear failure reasons.
- Support pause by aborting the active request while preserving the `.part` file.
- Support resume only when the server supports Range.
- If Range is not supported, fail resume cleanly with a clear error.
- Allow retry to restart from the beginning if needed.
- Support cancel by aborting the active request and marking the record canceled.

Downloader state transitions:

- `queued` -> `downloading`
- `downloading` -> `paused`
- `paused` -> `downloading` when Range resume succeeds
- `paused` -> `failed` when Range resume is unsupported
- `downloading` -> `completed`
- `downloading` -> `failed`
- `downloading` -> `canceled`
- `failed` -> `queued` or `downloading` through retry
- `canceled` remains terminal for the original attempt

## Desktop App

### Electron Main

Responsibilities:

- Resolve the user data directory.
- Initialize the SQLite database at startup.
- Run schema migrations.
- Register IPC handlers.
- Own downloader service instances.
- Persist every meaningful state change.
- Broadcast progress and terminal events to renderer windows.
- Open folder picker dialogs.

### Preload

Expose only this API:

```ts
addDownload(url, savePath)
pauseDownload(id)
resumeDownload(id)
cancelDownload(id)
retryDownload(id)
getDownloads()
onDownloadProgress(callback)
```

The preload API must not expose:

- Node.js filesystem APIs
- SQLite APIs
- `better-sqlite3`
- Downloader internals
- Arbitrary IPC send/invoke access

### Renderer

The renderer is a React app with:

- Sidebar
  - Downloads
  - History
  - Settings
- Add URL input
- Save folder selector
- Start download button
- Downloads table
  - File name
  - URL
  - Size
  - Progress
  - Speed
  - Status
  - Actions

The renderer gets initial records through `getDownloads()` and keeps the table fresh through `onDownloadProgress(callback)`.

Actions map to the safe preload API:

- Start: `addDownload(url, savePath)`
- Pause: `pauseDownload(id)`
- Resume: `resumeDownload(id)`
- Cancel: `cancelDownload(id)`
- Retry: `retryDownload(id)`

## IPC Design

IPC is the only bridge between renderer and privileged logic.

Main-process handlers:

- `downloads:add`
- `downloads:pause`
- `downloads:resume`
- `downloads:cancel`
- `downloads:retry`
- `downloads:list`

Main-to-renderer event:

- `downloads:progress`

The exact channel names may be constants in `packages/shared` to avoid string drift.

IPC validation:

- `url` must be a valid HTTP or HTTPS URL.
- `savePath` must be a non-empty path selected by the user.
- `id` must refer to an existing download record for control operations.
- Invalid requests return structured errors rather than throwing raw implementation details into the renderer.

## Persistence Flow

1. User selects a folder through the Electron folder picker.
2. User enters a URL and starts a download.
3. Renderer calls `addDownload(url, savePath)`.
4. Main validates input.
5. Main creates a queued database record.
6. Main starts downloader.
7. Main updates status to `downloading`.
8. Downloader emits progress events.
9. Main persists progress and speed periodically and on meaningful state changes.
10. Main broadcasts progress events to renderer.
11. On completion, downloader finalizes the file from `.part` to final filename.
12. Main persists `completed`, final size, progress, and `completed_at`.

## Why `better-sqlite3`

`better-sqlite3` is chosen for Phase 1 because the database is local, embedded, and accessed only from the Electron main process. Its synchronous prepared-statement API keeps the persistence layer simple and predictable for small state updates such as download progress, status transitions, and history reads.

The renderer never imports or talks to `better-sqlite3`. All database access stays behind `packages/database`, called from Electron main.

The SQLite file is stored under Electron `app.getPath("userData")`, which maps to an OS-appropriate per-user application data directory:

- macOS: under the user's Application Support directory
- Windows: under the user's AppData directory

The app documentation will name the exact database filename and explain how this path is resolved.

## Commands

Root package commands:

- `pnpm install`
- `pnpm dev`
- `pnpm dev:desktop`
- `pnpm build`
- `pnpm package:mac`
- `pnpm package:win`

`pnpm dev` may delegate to `pnpm dev:desktop`.

## Testing Plan

Add practical tests for:

- File name detection from `Content-Disposition`
- File name fallback from URL
- URL validation for HTTP/HTTPS only
- Database schema initialization
- Database status persistence
- Downloader state transitions
- Resume support detection when practical

Tests should prioritize package-level behavior because the downloader and database packages contain the highest-risk logic. Electron UI verification can use typecheck/build plus manual runtime validation for Phase 1.

## Acceptance Criteria

- The Electron app can run locally.
- A user can paste a direct HTTP/HTTPS file URL.
- A user can choose a save folder.
- The file downloads successfully.
- UI shows progress.
- UI shows speed.
- Download history is saved in SQLite.
- Pause/resume works when the server supports Range.
- Resume fails cleanly when the server does not support Range.
- Cancel works.
- Retry works.
- The renderer remains database-agnostic.
- No Chrome extension is included.
- No video detection is included.

## Out Of Scope For Phase 1

Do not implement:

- Chrome extension
- Video detection
- `yt-dlp`
- `ffmpeg`
- HLS/DASH
- DRM-related handling
- Native Messaging
- Browser capture
- Media conversion
- Download scheduling
- Authentication flows

## Self-Review

Placeholder scan:

- No unresolved TODO, TBD, or placeholder sections remain.

Internal consistency:

- The architecture consistently keeps filesystem, SQLite, downloader execution, folder selection, and progress broadcasting in Electron main.
- The renderer is consistently limited to the preload IPC API.
- `better-sqlite3` is consistently scoped to `packages/database` and Electron main usage.

Scope check:

- The spec is focused on Phase 1 desktop manual URL downloads.
- Chrome extension, video detection, Native Messaging, `yt-dlp`, `ffmpeg`, HLS/DASH, and DRM-related handling are explicitly out of scope.

Ambiguity check:

- Resume behavior is explicit: resume requires Range support; unsupported resume fails cleanly; retry may restart from the beginning.
- Filename detection precedence is explicit: `Content-Disposition` first, URL fallback second, safe fallback last.
- Database location is explicit: under Electron `app.getPath("userData")`.
