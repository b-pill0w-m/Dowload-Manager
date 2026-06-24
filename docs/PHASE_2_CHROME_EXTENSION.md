# Phase 2 Chrome Extension

## Overview

Phase 2 adds Google Chrome Extension support. The extension detects normal downloadable request candidates and sends only user-selected items to the Electron desktop app.

The Chrome extension does not download files. The Electron desktop app remains the only download execution path.

## Scope

Included:

- Chrome Extension Manifest V3
- `chrome.webRequest` detection
- Detection by URL extension
- Detection by response `Content-Type`
- Popup UI with current tab candidates
- Local Electron server on `127.0.0.1:17891`
- `GET /health`
- `POST /detected`
- Desktop `Detected Media` page
- SQLite persistence for detected items

Not included:

- `yt-dlp`
- `ffmpeg`
- HLS/DASH merging
- DRM bypass
- Paywall bypass
- Token extraction
- Cookie extraction
- Authentication bypass
- Auto-download from the extension

## Run Electron App

Install dependencies:

```bash
pnpm install
```

Start the Electron app:

```bash
pnpm dev
```

The dev command rebuilds `better-sqlite3` for Electron before launching.

## Verify Local Server

With the Electron app running:

```bash
curl http://127.0.0.1:17891/health
```

Expected response:

```json
{"ok":true,"service":"download-manager"}
```

The server listens only on `127.0.0.1`.

## Build Chrome Extension

```bash
pnpm --filter @download-manager/chrome-extension build
```

The unpacked extension output is:

```text
apps/chrome-extension/dist
```

## Load Unpacked Extension In Chrome

1. Open Google Chrome.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select `apps/chrome-extension/dist`.

## Test Detection

1. Start the Electron app with `pnpm dev`.
2. Load the unpacked Chrome extension.
3. Open a direct `.mp4` URL in Chrome, such as a test file hosted on a normal HTTP/HTTPS server.
4. Open the extension popup.
5. Confirm the detected item appears.
6. Click Send to App.
7. Open the desktop app's Detected Media page.
8. Click Download.

Repeat with a direct `.pdf` URL.

## Detection Rules

URL extensions:

- `.mp4`
- `.webm`
- `.mkv`
- `.mov`
- `.m3u8`
- `.mpd`
- `.ts`
- `.m4s`
- `.m4a`
- `.vtt`
- `.zip`
- `.pdf`
- `.docx`
- `.xlsx`

Content types:

- `video/*`
- `audio/*`
- `application/vnd.apple.mpegurl`
- `application/x-mpegURL`
- `application/dash+xml`
- `application/pdf`
- `application/zip`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

`.m3u8` and `.mpd` are only detected as candidates in Phase 2. They are not merged or processed as video streams.

## Known Limitations

- The extension detects candidates, not guaranteed downloadable final files.
- Some sites hide downloads behind authentication or expiring URLs; Phase 2 does not extract cookies or tokens.
- HLS/DASH URLs are listed as candidates only.
- Downloads started from Detected Media save to the OS Downloads folder.
- The desktop app must be running before Send to App can succeed.
