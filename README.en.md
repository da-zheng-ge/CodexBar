# CodexBar

[中文](README.md)

CodexBar is a Windows-only Electron taskbar quota bar for Codex. It reads local Codex rate limits through `codex app-server --stdio` and renders a compact always-on-top bar near the Windows taskbar.

## Install

### Option 1: Download with Codex (Recommended)

Open Codex and ask it to download the latest CodexBar build:

```text
Download the latest portable CodexBar exe from https://github.com/da-zheng-ge/CodexBar/releases/latest and place it on my desktop.
```

Then double-click `CodexBar.x.y.z.exe`. The portable build does not require installation.

### Option 2: Manual Download

Go to [GitHub Releases](https://github.com/da-zheng-ge/CodexBar/releases/latest) and download the latest Windows build:

- `CodexBar.x.y.z.exe`: portable build, no install required.
- `CodexBar.Setup.x.y.z.exe`: Windows installer.

### Requirements

- Windows.
- Codex Desktop installed and signed in.
- `codex.exe` must be discoverable automatically or configured with `CODEX_PATH`.

If Windows shows a security warning, choose to keep/run the app. The first public builds are unsigned.

## Run from Source

```powershell
npm install
npm start
```

Set `CODEX_PATH` if `codex.exe` is not discoverable:

```powershell
$env:CODEX_PATH = 'C:\path\to\codex.exe'
npm start
```

## Build

Create a local unpacked build:

```powershell
npm run pack
```

Create distributable Windows builds in `dist/`:

```powershell
npm run dist
```

## Behavior

- Right-click for refresh and quit.
