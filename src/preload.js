const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexPet', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('settings:always-on-top', value),
  setLaunchAtLogin: (value) => ipcRenderer.invoke('settings:launch-at-login', value),
  setPet: (value) => ipcRenderer.invoke('settings:pet', value),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  beginDrag: (point) => ipcRenderer.send('window:drag-start', point),
  moveDrag: (point) => ipcRenderer.send('window:drag-move', point),
  endDrag: () => ipcRenderer.send('window:drag-end'),
  openCodexFolder: () => ipcRenderer.invoke('folder:open-codex'),
  onUsage: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('usage:update', handler);
    return () => ipcRenderer.removeListener('usage:update', handler);
  },
  onSettings: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('settings:update', handler);
    return () => ipcRenderer.removeListener('settings:update', handler);
  },
});
