# Packaging macOS and Windows 11

This project produces two desktop installer families from the Electron app.

## macOS

Build on macOS:

```bash
pnpm package:mac
```

Outputs are written to:

```text
apps/desktop/release
```

The default macOS build creates DMG and ZIP artifacts for the current machine architecture.

To force a specific macOS architecture:

```bash
pnpm package:mac:arm64
pnpm package:mac:x64
```

## Windows 11

Build on Windows 11 for the most reliable native output:

```powershell
pnpm package:win11
```

Outputs are written to:

```text
apps\desktop\release
```

The Windows 11 build creates an x64 NSIS installer with a setup wizard, Start Menu shortcut, and desktop shortcut.

## Browser Extension Resource

Both installers bundle the built browser extension from:

```text
apps/chrome-extension/dist
```

inside the app resources at:

```text
browser-extension
```

For a full IDM-style production install, publish the extension to the Chrome Web Store or another browser-accepted update URL, then add Windows registry integration in the installer using the stable extension ID and update URL.

Windows Chromium-based browsers do not allow silent permanent installation of arbitrary local unpacked extensions for consumer installs. Registry-based external install requires an update URL, and users may still need to enable the extension unless using managed enterprise policy.
