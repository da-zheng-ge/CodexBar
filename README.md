# CodexBar

CodexBar 是一个 Windows 专用的 Codex 任务栏额度条。它通过本机的 `codex app-server --stdio` 读取 Codex rate limits，并在 Windows 任务栏附近显示一个紧凑的置顶状态条。

## 安装

### 方式一：通过 Codex 下载（推荐）

打开 Codex，让它帮你下载最新版 CodexBar：

```text
请从 https://github.com/da-zheng-ge/CodexBar/releases/latest 下载 CodexBar 最新版便携版 exe，并放到桌面。
```

下载后双击 `CodexBar.0.1.0.exe` 运行即可。便携版不需要安装。

### 方式二：手动下载

前往 [GitHub Releases](https://github.com/da-zheng-ge/CodexBar/releases/latest)，下载最新版 Windows 程序：

- `CodexBar.0.1.0.exe`：便携版，下载后直接运行。
- `CodexBar.Setup.0.1.0.exe`：Windows 安装包。

### 使用前提

- Windows。
- 已安装并登录 Codex Desktop。
- `codex.exe` 可以被自动发现，或通过 `CODEX_PATH` 指定。

如果 Windows 显示安全提示，请选择保留/仍要运行。当前公开版本暂未进行代码签名。

## 从源码运行

```powershell
npm install
npm start
```

如果无法自动找到 `codex.exe`，可以设置 `CODEX_PATH`：

```powershell
$env:CODEX_PATH = 'C:\path\to\codex.exe'
npm start
```

## 构建

创建本地 unpacked 构建：

```powershell
npm run pack
```

创建可分发的 Windows 构建，输出到 `dist/`：

```powershell
npm run dist
```

## 功能

- 紧凑视图：`5H xx% | 7D xx%`
- 点击状态条可展开查看重置时间。
- 右键菜单支持刷新、重置位置和退出。
- 应用不会读取 API keys、认证文件、提示词或回复内容。

---

## English

CodexBar is a Windows-only Electron taskbar quota bar for Codex. It reads local Codex rate limits through `codex app-server --stdio` and renders a compact always-on-top bar near the Windows taskbar.

## Install

### Option 1: Download with Codex (Recommended)

Open Codex and ask it to download the latest CodexBar build:

```text
Download the latest portable CodexBar exe from https://github.com/da-zheng-ge/CodexBar/releases/latest and place it on my desktop.
```

Then double-click `CodexBar.0.1.0.exe`. The portable build does not require installation.

### Option 2: Manual Download

Go to [GitHub Releases](https://github.com/da-zheng-ge/CodexBar/releases/latest) and download the latest Windows build:

- `CodexBar.0.1.0.exe`: portable build, no install required.
- `CodexBar.Setup.0.1.0.exe`: Windows installer.

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

- Compact view: `5H xx% | 7D xx%`
- Click the bar to expand reset times.
- Right-click for refresh, reset position, and quit.
- The app does not read API keys, auth files, prompts, or responses.
