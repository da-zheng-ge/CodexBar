'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexbar', {
  getLatest: () => ipcRenderer.invoke('usage:getLatest'),
  refresh: () => ipcRenderer.invoke('usage:refresh'),
  resetPosition: () => ipcRenderer.invoke('window:resetPosition'),
  showContextMenu: () => ipcRenderer.invoke('window:showContextMenu'),
  quit: () => ipcRenderer.invoke('window:quit'),
  onUsageUpdate: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('usage:update', listener);
    return () => ipcRenderer.removeListener('usage:update', listener);
  }
});
