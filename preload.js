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

  onGameStatus: (callback) => ipcRenderer.on('game-status', (_event, data) => callback(data)),

  // Opções de inicialização: escolher um executável manualmente,
  // esquecer o que foi escolhido, e abrir links externos (Steam / outro
  // link configurado em launch-config.js) quando nenhum jogo é encontrado.
  browseGameExecutable: () => ipcRenderer.invoke('browse-game-executable'),
  clearGameExecutable: () => ipcRenderer.send('clear-game-executable'),
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

  getVersion: () => ipcRenderer.invoke('get-app-version'),

  // Anúncios: busca os dados do GitHub (ou cache local) e retorna a lista.
  // Chamado pelo announcements.js na abertura e a cada 2 minutos.
  getAnnouncements: () => ipcRenderer.invoke('get-announcements'),

  // Abre qualquer URL de anúncio no navegador padrão do sistema.
  openAnnouncementLink: (url) => ipcRenderer.send('open-announcement-link', url)
});