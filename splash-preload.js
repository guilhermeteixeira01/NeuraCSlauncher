const { contextBridge, ipcRenderer } = require('electron');

// Preload isolado pra splash — bem mais restrito que o preload.js da
// janela principal, já que essa tela não precisa de quase nada além de
// receber texto de status e saber quando fazer o fade-out.
contextBridge.exposeInMainWorld('splashApi', {
  onStatus: (callback) => ipcRenderer.on('splash-status', (_event, text) => callback(text)),
  onProgress: (callback) => ipcRenderer.on('splash-progress', (_event, pct) => callback(pct)),
  onVersion: (callback) => ipcRenderer.on('splash-version', (_event, version) => callback(version)),
  onFadeOut: (callback) => ipcRenderer.on('splash-fade-out', () => callback())
});
