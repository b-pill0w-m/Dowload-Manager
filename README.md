# Download Manager

Cross-platform desktop download manager built with Electron, React, TypeScript, Vite, pnpm, SQLite, and a Node.js download core.

## Phase 1 Scope

Implemented in this phase:

- Electron desktop app for macOS and Windows
- Manual direct HTTP/HTTPS file URL downloads
- Pause, resume, cancel, and retry controls
- Progress, speed, size, and status display
- SQLite download history
- Main-process-only filesystem, downloader, and database access
- Safe preload IPC API for the renderer

Not included in Phase 1:

- Chrome extension
- Local server on `127.0.0.1:17891`
- `/health` or `/detected` endpoints
- Video detection
- `yt-dlp`
- `ffmpeg`
- HLS/DASH support
- DRM-related handling

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

This starts the Vite renderer and launches the Electron desktop app.

You can also run the desktop app command directly:

```bash
pnpm dev:desktop
```

## Build

```bash
pnpm build
```

## Package

macOS:

```bash
pnpm package:mac
```

Windows:

```bash
pnpm package:win
```

Run the Windows packaging command on Windows for the most reliable output.

## SQLite Storage

The app uses `better-sqlite3` only from `packages/database`, called by the Electron main process. The renderer never imports SQLite or accesses the database directly.

The SQLite file is created under Electron's `app.getPath("userData")` directory with this filename:

```text
downloads.sqlite
```

Typical locations:

- macOS: `~/Library/Application Support/Download Manager/downloads.sqlite`
- Windows: `%APPDATA%\Download Manager\downloads.sqlite`

## Known Limitations

- Only direct HTTP and HTTPS file URLs are supported.
- Resume works only when the server supports HTTP Range requests.
- Resume fails cleanly if the server does not support Range.
- Retry may restart a failed download from the beginning.
- No browser extension or media detection is included in Phase 1.

## Phase 2 Chrome Extension

Phase 2 adds a Chrome Extension Manifest V3 app under `apps/chrome-extension`.

The extension detects normal downloadable request candidates and sends only user-selected items to the Electron app at:

```text
http://127.0.0.1:17891/detected
```

The Electron app exposes a local health endpoint while running:

```bash
curl http://127.0.0.1:17891/health
```

Build the extension:

```bash
pnpm --filter @download-manager/chrome-extension build
```

Load this folder in Chrome as an unpacked extension:

```text
apps/chrome-extension/dist
```

Phase 2 still does not include `yt-dlp`, `ffmpeg`, DRM bypass, paywall bypass, token extraction, cookie extraction, auto-download from the extension, or HLS/DASH merging.

## Phase 3 Video Support

Phase 3 adds basic non-DRM video support:

- Direct `.mp4` and `.webm` use the existing downloader.
- HLS `.m3u8` and DASH `.mpd` use `yt-dlp` first, with `ffmpeg` fallback where appropriate.
- Settings shows whether `yt-dlp` and `ffmpeg` are installed.

Install on macOS:

```bash
brew install yt-dlp ffmpeg
```

Install on Windows:

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

Phase 3 does not bypass DRM, decrypt protected streams, bypass paywalls, extract private tokens, extract cookies, or bypass authentication.
