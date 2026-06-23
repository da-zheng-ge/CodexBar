# CodexBar

CodexBar is a Windows-only Electron taskbar quota bar for Codex. It reads local Codex rate limits through `codex app-server --stdio` and renders a compact always-on-top bar near the Windows taskbar.

## Download

Download the latest Windows executable from the [GitHub Releases](https://github.com/da-zheng-ge/CodexBar/releases) page.

Requirements:

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

- Compact view: `5H xx% | 7D xx%`
- Click the bar to expand reset times.
- Right-click for refresh, reset position, and quit.
- The app does not read API keys, auth files, prompts, or responses.
