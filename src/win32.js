'use strict';

const os = require('node:os');

let koffi;
let user32;

const GWL_EXSTYLE = -20;
const GWL_STYLE = -16;
const GWLP_HWNDPARENT = -8;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_TOPMOST = 0x00000008;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_NOACTIVATE = 0x08000000;
const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SWP_NOOWNERZORDER = 0x0200;
const WIN11_LEFT_ANCHOR_X = 720;
const WIN11_BUILD_NUMBER = 22000;
const CLASSIC_ANCHOR_X = 980;
const CLASSIC_RIGHT_SAFE_GAP = 16;

function load() {
  if (process.platform !== 'win32') {
    return null;
  }

  if (!koffi) {
    koffi = require('koffi');
    user32 = koffi.load('user32.dll');

    koffi.struct('RECT', {
      left: 'long',
      top: 'long',
      right: 'long',
      bottom: 'long'
    });
  }

  return {
    FindWindowW: user32.func('uintptr_t __stdcall FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)'),
    FindWindowExW: user32.func('uintptr_t __stdcall FindWindowExW(uintptr_t hWndParent, uintptr_t hWndChildAfter, const wchar_t *lpszClass, const wchar_t *lpszWindow)'),
    GetParent: user32.func('uintptr_t __stdcall GetParent(uintptr_t hWnd)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ RECT *lpRect)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int nIndex)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t hWnd, int nIndex, intptr_t dwNewLong)'),
    SetParent: user32.func('uintptr_t __stdcall SetParent(uintptr_t hWndChild, uintptr_t hWndNewParent)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(uintptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)')
  };
}

function hwndFromBuffer(nativeHandle) {
  if (!Buffer.isBuffer(nativeHandle)) {
    return 0;
  }

  if (os.arch() === 'x64' || os.arch() === 'arm64') {
    return Number(nativeHandle.readBigUInt64LE(0));
  }

  return nativeHandle.readUInt32LE(0);
}

function getTaskbarHwnd() {
  const api = load();
  if (!api) {
    return 0;
  }

  return Number(api.FindWindowW('Shell_TrayWnd', null));
}

function isWindows11OrLater() {
  const release = os.release().split('.').map((part) => Number.parseInt(part, 10));
  return release.length >= 3 && release[2] >= WIN11_BUILD_NUMBER;
}

function getTaskbarRect() {
  const api = load();
  if (!api) {
    return null;
  }

  const taskbar = getTaskbarHwnd();
  if (!taskbar) {
    return null;
  }

  const rect = {};
  if (!api.GetWindowRect(taskbar, rect)) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom
  };
}

function rectForHwnd(hwnd) {
  const api = load();
  if (!api || !hwnd) {
    return null;
  }

  const rect = {};
  if (!api.GetWindowRect(hwnd, rect)) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom
  };
}

function findTaskbarChild(parent, classNames) {
  const api = load();
  if (!api || !parent) {
    return 0;
  }

  for (const className of classNames) {
    const hwnd = Number(api.FindWindowExW(parent, 0, className, null));
    if (hwnd) {
      return hwnd;
    }
  }

  return 0;
}

function getTaskbarAttachInfo(width, height) {
  const api = load();
  const taskbar = getTaskbarHwnd();
  if (!api || !taskbar) {
    return null;
  }

  const taskbarRect = rectForHwnd(taskbar);
  if (!taskbarRect) {
    return null;
  }

  const taskbarWidth = taskbarRect.right - taskbarRect.left;
  const taskbarHeight = taskbarRect.bottom - taskbarRect.top;

  const bar = findTaskbarChild(taskbar, ['ReBarWindow32', 'WorkerW']);
  const list = findTaskbarChild(bar, ['MSTaskSwWClass', 'MSTaskListWClass']);
  const barRect = rectForHwnd(bar);
  const listRect = rectForHwnd(list);
  if (bar && barRect && listRect && taskbarWidth >= taskbarHeight) {
    const barHeight = barRect.bottom - barRect.top;
    const barWidth = barRect.right - barRect.left;
    return {
      mode: 'classic',
      parent: bar,
      taskbar,
      x: Math.max(2, barWidth - width - CLASSIC_RIGHT_SAFE_GAP),
      y: Math.max(0, Math.round((barHeight - height) / 2)),
      width,
      height,
      taskbarRect
    };
  }

  const trayNotify = Number(api.FindWindowExW(taskbar, 0, 'TrayNotifyWnd', null));
  const start = Number(api.FindWindowExW(taskbar, 0, 'Start', null));
  const trayRect = rectForHwnd(trayNotify);
  const startRect = rectForHwnd(start);
  if (isWindows11OrLater() && trayRect && startRect && taskbarWidth >= taskbarHeight) {
    return {
      mode: 'win11',
      parent: taskbar,
      taskbar,
      x: Math.min(Math.max(2, WIN11_LEFT_ANCHOR_X), Math.max(2, taskbarWidth - width - 260)),
      y: Math.max(0, Math.round((taskbarHeight - height) / 2)),
      width,
      height,
      taskbarRect
    };
  }

  return null;
}

function attachAsTaskbarChild(nativeHandle, width, height) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  const info = getTaskbarAttachInfo(width, height);
  if (!api || !hwnd || !info || !info.parent) {
    return null;
  }

  const style = Number(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
  api.SetWindowLongPtrW(hwnd, GWL_STYLE, (style | WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS));

  const exStyle = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  api.SetWindowLongPtrW(
    hwnd,
    GWL_EXSTYLE,
    (exStyle | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE) & ~WS_EX_TOPMOST
  );

  const previousParent = Number(api.SetParent(hwnd, info.parent));
  const currentParent = Number(api.GetParent(hwnd));
  if (!previousParent && currentParent !== info.parent) {
    return null;
  }

  const moved = api.SetWindowPos(
    hwnd,
    0,
    info.x,
    info.y,
    info.width,
    info.height,
    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER
  );

  return moved ? info : null;
}

function moveTaskbarChild(nativeHandle, width, height) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  const info = getTaskbarAttachInfo(width, height);
  if (!api || !hwnd || !info) {
    return null;
  }

  const moved = api.SetWindowPos(
    hwnd,
    0,
    info.x,
    info.y,
    info.width,
    info.height,
    SWP_NOACTIVATE | SWP_NOOWNERZORDER
  );

  return moved ? info : null;
}

function applyNoActivateToolWindow(nativeHandle) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  if (!api || !hwnd) {
    return false;
  }

  const current = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  const next = current | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE;
  api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
  return api.SetWindowPos(
    hwnd,
    HWND_TOPMOST,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW
  );
}

function repairNoActivateToolWindow(nativeHandle) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  if (!api || !hwnd) {
    return false;
  }

  const current = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  const next = current | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE;
  api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
  return api.SetWindowPos(
    hwnd,
    HWND_TOPMOST,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
  );
}

function attachToTaskbar(nativeHandle) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  const taskbar = getTaskbarHwnd();
  if (!api || !hwnd || !taskbar) {
    return false;
  }

  api.SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, taskbar);
  return true;
}

function getWindowState(nativeHandle) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  const taskbar = getTaskbarHwnd();
  if (!api || !hwnd) {
    return null;
  }

  const rect = {};
  const hasRect = api.GetWindowRect(hwnd, rect);
  const exStyle = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  const style = Number(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
  const owner = Number(api.GetWindowLongPtrW(hwnd, GWLP_HWNDPARENT));
  const parent = Number(api.GetParent(hwnd));
  const attachInfo = getTaskbarAttachInfo(rect.right - rect.left, rect.bottom - rect.top);
  const parentRect = attachInfo && rectForHwnd(attachInfo.parent);
  const relativeRect = hasRect && parentRect
    ? {
        left: rect.left - parentRect.left,
        top: rect.top - parentRect.top,
        right: rect.right - parentRect.left,
        bottom: rect.bottom - parentRect.top
      }
    : null;

  return {
    hwnd,
    owner,
    parent,
    taskbar,
    isChild: Boolean(style & WS_CHILD),
    hasTaskbarParent: Boolean(attachInfo && parent === attachInfo.parent),
    hasTaskbarOwner: Boolean(taskbar && owner === taskbar),
    hasExpectedExStyle: (exStyle & (WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE))
      === (WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE),
    rect: hasRect
      ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        }
      : null,
    relativeRect
  };
}

function keepAboveTaskbar(nativeHandle) {
  const api = load();
  const hwnd = hwndFromBuffer(nativeHandle);
  if (!api || !hwnd) {
    return false;
  }

  return api.SetWindowPos(
    hwnd,
    HWND_TOPMOST,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
  );
}

module.exports = {
  attachAsTaskbarChild,
  attachToTaskbar,
  applyNoActivateToolWindow,
  repairNoActivateToolWindow,
  getTaskbarAttachInfo,
  isWindows11OrLater,
  getWindowState,
  getTaskbarRect,
  keepAboveTaskbar,
  moveTaskbarChild
};
