'use strict';

const { app, BrowserWindow, Menu, Tray, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { attachAsTaskbarChild, attachToTaskbar, applyNoActivateToolWindow, repairNoActivateToolWindow, getWindowState, getTaskbarAttachInfo, getTaskbarRect, keepAboveTaskbar, moveTaskbarChild } = require('./win32');

const COLLAPSED_SIZE = { width: 540, height: 70 };
const RIGHT_TASKBAR_SAFE_MARGIN = 260;
const REFRESH_INTERVAL_MS = 30_000;
const ACTIVITY_POLL_INTERVAL_MS = 1_500;
const THINKING_STALE_MS = 30 * 60 * 1_000;
const TASKBAR_GUARD_INTERVAL_MS = 2_500;
const DEV_RELOAD_DEBOUNCE_MS = 350;

let mainWindow;
let usageService;
let tray;
let contextMenu;
let taskbarGuard;
let devReloadTimer;
let devReloadWatcher;
let isRelaunching = false;
let taskbarAttachMode = 'fallback';

class UsageService {
  constructor() {
    this.codexPath = resolveCodexExecutable();
    this.process = null;
    this.nextId = 2;
    this.pending = new Map();
    this.buffer = '';
    this.snapshot = {
      primaryRemainingPercent: null,
      secondaryRemainingPercent: null,
      primaryResetsAt: null,
      secondaryResetsAt: null,
      updatedAt: 0,
      status: 'connecting',
      isThinking: false
    };
  }

  start() {
    this.updateThinkingState();
    this.activityInterval = setInterval(() => this.updateThinkingState(), ACTIVITY_POLL_INTERVAL_MS);

    if (!this.codexPath) {
      this.setError('codex.exe was not found. Set CODEX_PATH or install/open Codex Desktop.');
      return;
    }

    try {
      this.process = spawn(this.codexPath, ['app-server', '--stdio'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout.setEncoding('utf8');
      this.process.stdout.on('data', (chunk) => this.onStdout(chunk));
      this.process.stderr.on('data', () => {});
      this.process.on('exit', () => {
        this.process = null;
        this.setError('Codex app-server exited.');
      });
      this.process.on('error', (error) => this.setError(error.message));

      this.send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'codexbar', title: 'CodexBar', version: app.getVersion() } } });
      this.send({ method: 'initialized', params: {} });
      this.refresh();
      this.interval = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
    } catch (error) {
      this.setError(error.message);
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
      this.activityInterval = null;
    }

    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(new Error('Usage service stopped.'));
    }
    this.pending.clear();

    if (this.process && !this.process.killed) {
      this.process.kill();
    }
  }

  getLatest() {
    return this.snapshot;
  }

  refresh() {
    if (!this.process || !this.process.stdin.writable) {
      return Promise.resolve(this.snapshot);
    }

    return this.request('account/rateLimits/read', {})
      .then((result) => {
        this.applyRateLimits(result && result.rateLimits);
        return this.snapshot;
      })
      .catch((error) => {
        this.setError(error.message);
        return this.snapshot;
      });
  }

  request(method, params) {
    const id = this.nextId++;
    const message = { method, id, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 10_000);

      this.pending.set(id, { resolve, reject, timeout });
      this.send(message);
    });
  }

  send(message) {
    if (!this.process || !this.process.stdin.writable) {
      return;
    }

    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);

        if (message.error) {
          pending.reject(new Error(message.error.message || 'Codex app-server error.'));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  applyRateLimits(rateLimits) {
    const primary = rateLimits && rateLimits.primary;
    const secondary = rateLimits && rateLimits.secondary;
    const primaryRemainingPercent = remainingPercent(primary);
    const secondaryRemainingPercent = remainingPercent(secondary);
    const primaryResetsAt = timestampOrNull(primary && primary.resetsAt);
    const secondaryResetsAt = timestampOrNull(secondary && secondary.resetsAt);

    this.snapshot = {
      primaryRemainingPercent: primaryRemainingPercent ?? this.snapshot.primaryRemainingPercent,
      secondaryRemainingPercent: secondaryRemainingPercent ?? this.snapshot.secondaryRemainingPercent,
      primaryResetsAt: primaryResetsAt ?? this.snapshot.primaryResetsAt,
      secondaryResetsAt: secondaryResetsAt ?? this.snapshot.secondaryResetsAt,
      updatedAt: Date.now(),
      status: 'ready',
      isThinking: this.snapshot.isThinking
    };
    broadcastUsage();
  }

  setError(message) {
    this.snapshot = {
      ...this.snapshot,
      status: 'error',
      errorMessage: message,
      updatedAt: Date.now()
    };
    broadcastUsage();
  }

  updateThinkingState() {
    const isThinking = getCodexThinkingState();
    if (this.snapshot.isThinking === isThinking) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      isThinking
    };
    broadcastUsage();
  }
}

function remainingPercent(window) {
  if (!window || typeof window.usedPercent !== 'number') {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
}

function timestampOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function getCodexThinkingState() {
  const sessionFile = getLatestSessionFile();
  if (!sessionFile) {
    return false;
  }

  const activity = readSessionActivity(sessionFile);
  if (!activity || !activity.lastTaskStartedAt) {
    return false;
  }

  if (Date.now() - activity.lastTaskStartedAt > THINKING_STALE_MS) {
    return false;
  }

  return !activity.lastTaskEndedAt || activity.lastTaskStartedAt > activity.lastTaskEndedAt;
}

function getLatestSessionFile() {
  const sessionsRoot = path.join(process.env.USERPROFILE || '', '.codex', 'sessions');
  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }

  let latest = null;
  const stack = [sessionsRoot];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = fs.statSync(fullPath);
          if (!latest || stat.mtimeMs > latest.mtimeMs) {
            latest = { path: fullPath, mtimeMs: stat.mtimeMs };
          }
        } catch {}
      }
    }
  }

  return latest && latest.path;
}

function readSessionActivity(sessionFile) {
  const maxBytes = 256 * 1024;
  let content;
  try {
    const stat = fs.statSync(sessionFile);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const fd = fs.openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    content = buffer.toString('utf8');
    if (start > 0) {
      content = content.slice(content.indexOf('\n') + 1);
    }
  } catch {
    return null;
  }

  let lastTaskStartedAt = 0;
  let lastTaskEndedAt = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.includes('"type":"event_msg"') || !line.includes('"payload":{"type":"')) {
      continue;
    }

    const payloadType = matchJsonString(line, '"payload":{"type":"');
    if (!payloadType) {
      continue;
    }

    const timestamp = Date.parse(matchJsonString(line, '"timestamp":"') || '');
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    if (payloadType === 'task_started') {
      lastTaskStartedAt = timestamp;
    } else if (isTaskEndEvent(payloadType)) {
      lastTaskEndedAt = timestamp;
    }
  }

  return { lastTaskStartedAt, lastTaskEndedAt };
}

function matchJsonString(line, prefix) {
  const start = line.indexOf(prefix);
  if (start === -1) {
    return null;
  }

  const valueStart = start + prefix.length;
  const valueEnd = line.indexOf('"', valueStart);
  if (valueEnd === -1) {
    return null;
  }

  return line.slice(valueStart, valueEnd);
}

function isTaskEndEvent(type) {
  return type === 'task_complete'
    || type === 'turn_aborted'
    || type === 'turn_failed'
    || type === 'task_failed';
}

function resolveCodexExecutable() {
  if (process.env.CODEX_PATH && fs.existsSync(process.env.CODEX_PATH) && !isWindowsAppsAlias(process.env.CODEX_PATH)) {
    return process.env.CODEX_PATH;
  }

  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    ...findCodexExecutables(path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex')),
    ...findCodexExecutables(path.join(process.env.USERPROFILE || '', '.vscode', 'extensions'))
  ];

  for (const pathPart of (process.env.PATH || '').split(path.delimiter)) {
    if (!pathPart) {
      continue;
    }
    candidates.push(path.join(pathPart, 'codex.exe'));
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate) && !isWindowsAppsAlias(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return null;
}

function findCodexExecutables(root) {
  const results = [];
  if (!root || !fs.existsSync(root)) {
    return results;
  }

  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === 'codex.exe') {
        results.push(fullPath);
      }
    }
  }

  return results.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
}

function isWindowsAppsAlias(candidate) {
  return candidate.toLowerCase().includes('\\windowsapps\\');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: COLLAPSED_SIZE.width,
    height: COLLAPSED_SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    placeWindow();
    mainWindow.showInactive();
    applyNativeWindowBehavior();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function applyNativeWindowBehavior() {
  if (!mainWindow || process.platform !== 'win32') {
    return;
  }

  try {
    const handle = mainWindow.getNativeWindowHandle();
    const childInfo = attachAsTaskbarChild(handle, COLLAPSED_SIZE.width, COLLAPSED_SIZE.height);
    if (childInfo) {
      taskbarAttachMode = 'child';
      return;
    }

    taskbarAttachMode = 'fallback';
    applyNoActivateToolWindow(handle);
    attachToTaskbar(handle);
    keepAboveTaskbar(handle);
  } catch (error) {
    console.warn(`Win32 attach failed: ${error.message}`);
  }
}

function startTaskbarGuard() {
  if (taskbarGuard) {
    clearInterval(taskbarGuard);
  }

  taskbarGuard = setInterval(() => {
    keepTaskbarPlacementStable();
  }, TASKBAR_GUARD_INTERVAL_MS);

  screen.on('display-metrics-changed', keepTaskbarPlacementStable);
  screen.on('display-added', keepTaskbarPlacementStable);
  screen.on('display-removed', keepTaskbarPlacementStable);
}

function keepTaskbarPlacementStable() {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
      return;
    }

    try {
      const handle = mainWindow.getNativeWindowHandle();
      const state = getWindowState(handle);
      const expectedBounds = getDesiredWindowBounds();
      const actualBounds = state && taskbarAttachMode === 'child' && state.relativeRect
        ? rectToBounds(state.relativeRect)
        : state && state.rect
          ? rectToBounds(state.rect)
          : mainWindow.getBounds();

      if (!boundsEqual(actualBounds, expectedBounds)) {
        if (taskbarAttachMode === 'child') {
          moveTaskbarChild(handle, COLLAPSED_SIZE.width, COLLAPSED_SIZE.height);
        } else {
          mainWindow.setBounds(expectedBounds, false);
        }
      }

      if (taskbarAttachMode === 'child') {
        if (!state || !state.isChild || !state.hasTaskbarParent) {
          applyNativeWindowBehavior();
        }
        return;
      }

      if (!state || !state.hasExpectedExStyle) {
        repairNoActivateToolWindow(handle);
      }

      if (!state || !state.hasTaskbarOwner) {
        attachToTaskbar(handle);
      }

      if (!state || !state.hasExpectedExStyle || !state.hasTaskbarOwner) {
        keepAboveTaskbar(handle);
      }
    } catch (error) {
      console.warn(`Taskbar guard failed: ${error.message}`);
    }
}

function placeWindow() {
  if (!mainWindow) {
    return false;
  }

  if (taskbarAttachMode === 'child') {
    return Boolean(moveTaskbarChild(mainWindow.getNativeWindowHandle(), COLLAPSED_SIZE.width, COLLAPSED_SIZE.height));
  }

  const nextBounds = getDesiredWindowBounds();
  const currentBounds = mainWindow.getBounds();
  if (boundsEqual(currentBounds, nextBounds)) {
    return false;
  }

  mainWindow.setBounds(nextBounds, false);
  return true;
}

function getDesiredWindowBounds() {
  const size = COLLAPSED_SIZE;
  if (taskbarAttachMode === 'child') {
    const attachInfo = getTaskbarAttachInfo(size.width, size.height);
    if (attachInfo) {
      return {
        x: attachInfo.x,
        y: attachInfo.y,
        width: attachInfo.width,
        height: attachInfo.height
      };
    }
  }

  const taskbar = safeTaskbarRect();
  const displays = screen.getAllDisplays();
  const display = displays.find((item) => rectIntersects(taskbar, item.bounds)) || screen.getPrimaryDisplay();
  const bounds = display.bounds;

  let x = Math.round(bounds.x + bounds.width - size.width - RIGHT_TASKBAR_SAFE_MARGIN);
  let y = Math.round(taskbar.top + ((taskbar.bottom - taskbar.top) - size.height) / 2);

  const taskbarWidth = taskbar.right - taskbar.left;
  const taskbarHeight = taskbar.bottom - taskbar.top;
  if (taskbarHeight > taskbarWidth) {
    x = Math.round(taskbar.left + ((taskbar.right - taskbar.left) - size.width) / 2);
    y = Math.round(bounds.y + bounds.height - size.height - 80);
  } else if (taskbar.top <= bounds.y) {
    y = taskbar.top;
  } else {
    y = taskbar.bottom - size.height;
  }

  x = clamp(x, bounds.x, bounds.x + bounds.width - size.width);
  y = clamp(y, bounds.y, bounds.y + bounds.height - size.height);
  return { x, y, width: size.width, height: size.height };
}

function boundsEqual(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function rectToBounds(rect) {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top
  };
}

function safeTaskbarRect() {
  try {
    const rect = getTaskbarRect();
    if (rect && rect.right > rect.left && rect.bottom > rect.top) {
      return rect;
    }
  } catch (error) {
    console.warn(`Taskbar rect failed: ${error.message}`);
  }

  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;
  if (workArea.height < bounds.height) {
    return {
      left: bounds.x,
      top: workArea.y + workArea.height,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height
    };
  }

  return {
    left: bounds.x,
    top: bounds.y + bounds.height - COLLAPSED_SIZE.height,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height
  };
}

function rectIntersects(rect, bounds) {
  return rect.left < bounds.x + bounds.width
    && rect.right > bounds.x
    && rect.top < bounds.y + bounds.height
    && rect.bottom > bounds.y;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function broadcastUsage() {
  if (mainWindow && !mainWindow.isDestroyed() && usageService) {
    mainWindow.webContents.send('usage:update', usageService.getLatest());
  }
}

function createTray() {
  const icon = path.join(__dirname, 'tray.ico');
  tray = fs.existsSync(icon) ? new Tray(icon) : null;
  contextMenu = Menu.buildFromTemplate([
    { label: 'Refresh', click: () => usageService.refresh() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  if (tray) {
    tray.setToolTip('CodexBar');
    tray.setContextMenu(contextMenu);
  }
}

function startDevReloadWatcher() {
  if (app.isPackaged || devReloadWatcher) {
    return;
  }

  devReloadWatcher = fs.watch(__dirname, (eventType, filename) => {
    if (!filename || !/\.(js|css|html)$/i.test(filename)) {
      return;
    }

    clearTimeout(devReloadTimer);
    devReloadTimer = setTimeout(() => {
      if (isRelaunching) {
        return;
      }

      isRelaunching = true;
      app.relaunch({ args: process.argv.slice(1) });
      app.exit(0);
    }, DEV_RELOAD_DEBOUNCE_MS);
  });
}

app.whenReady().then(() => {
  if (process.platform !== 'win32') {
    app.quit();
    return;
  }

  app.setAppUserModelId('CodexBar');
  usageService = new UsageService();
  createWindow();
  createTray();
  startTaskbarGuard();
  startDevReloadWatcher();
  usageService.start();
});

app.on('before-quit', () => {
  clearTimeout(devReloadTimer);
  if (devReloadWatcher) {
    devReloadWatcher.close();
    devReloadWatcher = null;
  }
  if (taskbarGuard) {
    clearInterval(taskbarGuard);
    taskbarGuard = null;
  }
  if (usageService) {
    usageService.stop();
  }
});

ipcMain.handle('usage:getLatest', () => usageService.getLatest());
ipcMain.handle('usage:refresh', () => usageService.refresh());
ipcMain.handle('window:resetPosition', () => {
  placeWindow();
  return true;
});
ipcMain.handle('window:showContextMenu', () => {
  if (contextMenu && mainWindow) {
    contextMenu.popup({ window: mainWindow });
  }
});
ipcMain.handle('window:quit', () => {
  app.quit();
});
