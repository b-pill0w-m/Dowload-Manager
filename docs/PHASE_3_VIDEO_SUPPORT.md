# Phase 3 Video Support

## Overview

Phase 3 adds basic non-DRM video download support.

The app supports:

- Direct `.mp4`
- Direct `.webm`
- HLS `.m3u8`
- DASH `.mpd`

Direct `.mp4` and `.webm` downloads continue to use the Phase 1 downloader core. HLS and DASH downloads use external tools from the Electron main process.

## Tool Detection

On startup, Electron checks:

- `yt-dlp --version`
- `ffmpeg -version`

The Settings page shows whether each tool is installed or missing.

## How yt-dlp Is Used

For HLS and DASH URLs, the app uses `yt-dlp` first.

Format analysis uses:

```bash
yt-dlp --dump-json --no-warnings <url>
```

Download uses:

```bash
yt-dlp --newline --no-part -o <output> <url>
```

When a selected format is provided, the app adds:

```bash
-f <format>
```

## How ffmpeg Is Used

If `yt-dlp` fails and `ffmpeg` is installed, the app can fall back to:

```bash
ffmpeg -y -i <url> -c copy <output>
```

This is intended for basic non-DRM HLS/DASH streams only.

## Install Tools On macOS

Using Homebrew:

```bash
brew install yt-dlp
brew install ffmpeg
```

## Install Tools On Windows

Using winget:

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

After installation, restart the Electron app so it can detect the tools.

## Download Stages

Video downloads may show:

- `analyzing`
- `downloading`
- `merging`
- `completed`
- `failed`

## DRM Restriction

If `yt-dlp` or `ffmpeg` reports DRM, encryption, or protected stream errors, the app stops the download and shows:

```text
This video is DRM-protected and cannot be downloaded.
```

The app does not:

- Bypass DRM
- Decrypt protected streams
- Bypass paywalls
- Extract private tokens
- Extract cookies
- Bypass authentication

## Limitations

- HLS/DASH support is basic and depends on installed `yt-dlp` and `ffmpeg`.
- Some streams require site-specific authentication or short-lived URLs; Phase 3 does not extract credentials.
- Format sizes are only shown when `yt-dlp` provides them.
- Direct video files still use normal HTTP/HTTPS download behavior.
