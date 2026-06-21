/**
 * Auto Update
 * ------------
 * Usa o electron-updater para checar, baixar e instalar atualizações
 * automaticamente, a partir dos releases publicados (GitHub Releases,
 * servidor genérico, ou S3 — configurado em package.json > build > publish).
 *
 * Fluxo:
 * 1. App abre → checkForUpdates()
 * 2. Se tem update disponível → baixa automaticamente
 * 3. Quando termina de baixar → avisa a renderer (botão "Reiniciar e atualizar")
 * 4. Usuário clica → quitAndInstall()
 *
 * IMPORTANTE: autoUpdater só funciona em app empacotado (.exe/.dmg/.AppImage
 * instalado), NÃO funciona com `npm start` / `electron .` em modo dev.
 * Para testar de verdade, gere um build com `npm run build` (local, sem
 * publicar) ou `npm run release` (builda E publica no GitHub Releases).
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

let mainWindow = null;

// Reverifica de tempos em tempos enquanto o launcher fica aberto — assim,
// se uma atualização sair enquanto o usuário já está com o app aberto há
// horas, ele ainda vai detectar sem precisar reabrir o launcher.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas

function init(win) {
  mainWindow = win;

  // Não baixa sozinho — deixa a gente controlar e avisar o usuário primeiro.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    send('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    send('update-status', { status: 'available', version: info.version });
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-not-available', () => {
    send('update-status', { status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    send('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send('update-status', { status: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdate] Erro:', err);
    send('update-status', { status: 'error', message: err?.message || String(err) });
  });

  // Primeira checagem é disparada manualmente em main.js (checkForUpdates()
  // logo no boot). A partir daí, esse intervalo cuida do resto.
  setInterval(() => {
    checkForUpdates();
  }, CHECK_INTERVAL_MS);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function checkForUpdates() {
  // Evita erro feio em modo dev (sem app empacotado / sem release publicado)
  if (!app.isPackaged) {
    console.log('[AutoUpdate] Ignorado: app não está empacotado (modo dev).');
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdate] Falha ao checar updates:', err);
  });
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = {
  init,
  checkForUpdates,
  quitAndInstall,
};