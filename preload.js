const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  launchGame: () => ipcRenderer.send('launch-game'),
  onLaunchStatus: (callback) => ipcRenderer.on('launch-status', (_event, data) => callback(data)),

  installUpdate: () => ipcRenderer.send('update-install'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, data) => callback(data)),

  onWindowState: (callback) => ipcRenderer.on('window-state', (_event, data) => callback(data)),

  onGameDetected: (callback) => ipcRenderer.on('game-detected', (_event, data) => callback(data)),

  onGameStatus: (callback) => ipcRenderer.on('game-status', (_event, data) => callback(data))
});
