# CodexBar

[English](README.en.md)

CodexBar 是一个 Windows 专用的 Codex 任务栏额度条。它通过本机的 `codex app-server --stdio` 读取 Codex rate limits，并在 Windows 任务栏附近显示一个紧凑的置顶状态条。

## 安装

### 方式一：通过 Codex 下载（推荐）

打开 Codex，让它帮你下载并运行最新版 CodexBar：

```text
请打开 https://github.com/da-zheng-ge/CodexBar/releases/latest，下载 CodexBar 最新版便携版 exe 到默认下载目录，下载完成后直接运行它。
```

Codex 会下载 `CodexBar-Portable.exe` 并启动它。便携版不需要安装。

### 方式二：手动下载

前往 [GitHub Releases](https://github.com/da-zheng-ge/CodexBar/releases/latest)，下载最新版 Windows 便携版：

- `CodexBar-Portable.exe`：便携版，下载后直接运行。

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

- 右键菜单支持查看当前版本、刷新、检查更新、打开 GitHub 项目主页、卸载和退出。
