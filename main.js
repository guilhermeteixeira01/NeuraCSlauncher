const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const discordRPC = require('./discord-rpc');
const autoUpdate = require('./auto-update');
const steamDetect = require('./steam-detect');
const gameWatcher = require('./game-watcher');

// Guarda o resultado da detecção do CS 1.6 pra usar depois, no clique de "JOGAR"
let cs16Info = { detected: false };
let tray = null;

// Live-reload em desenvolvimento: recarrega a janela sozinho quando você
// salva mudanças em src/ (HTML, CSS, JS). NÃO entra no app empacotado
// (app.isPackaged é false só em dev — npm start).
if (!app.isPackaged) {
  try {
    require('electron-reload')(path.join(__dirname, 'src'), {
      ignored: /node_modules|[/\\]\./
    });
    console.log('[LiveReload] Ativo — observando mudanças em /src');
  } catch (err) {
    console.warn('[LiveReload] electron-reload não encontrado, rode "npm install" novamente.');
  }
}

let mainWindow;

function createWindow() {
  const iconExt = process.platform === 'win32' ? 'ico'
                : process.platform === 'darwin' ? 'icns'
                : 'png';

  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    icon: path.join(__dirname, 'src', `logo.${iconExt}`),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Avisa a renderer quando o estado maximizado muda (inclusive via
  // duplo-clique na barra ou atalhos do sistema, não só pelo nosso botão),
  // pra tirar o arredondamento das bordas quando estiver maximizada.
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state', { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state', { maximized: false });
  });

  // mainWindow.webContents.openDevTools();
}

// Ícone na bandeja do sistema — é o que permite o launcher ficar de
// verdade em segundo plano (escondido) enquanto o jogo roda, sem deixar
// o usuário sem um jeito fácil de reabrir o launcher depois.
function createTray() {
  if (tray) return;

  const iconPath = path.join(__dirname, 'src', 'logo.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Neura CS Launcher');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir launcher',
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        tray.destroy();
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);

  // Clique simples no ícone também reabre (padrão esperado pela maioria
  // dos usuários, principalmente no Windows).
  tray.on('click', () => showMainWindow());
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  discordRPC.connect();

  autoUpdate.init(mainWindow);
  autoUpdate.checkForUpdates();

  // Detecta se o CS 1.6 já está instalado via Steam nesta máquina.
  // Roda só uma vez no boot — se o usuário instalar o jogo com o
  // launcher já aberto, ele precisa reabrir pra detectar (suficiente
  // pro caso de uso atual).
  cs16Info = steamDetect.detectCS16();
  if (cs16Info.detected) {
    console.log('[SteamDetect] CS 1.6 encontrado em:', cs16Info.installPath);
  } else {
    console.log('[SteamDetect] CS 1.6 não encontrado:', cs16Info.reason);
  }

  mainWindow.webContents.once('did-finish-load', () => {
    // Pequeno delay propositado: sem ele a checagem é tão rápida que o
    // estado "verificando..." nem pisca na tela — fica mais claro pro
    // usuário que o launcher de fato checou a instalação.
    setTimeout(() => {
      mainWindow.webContents.send('game-detected', cs16Info);
    }, 1200);
  });
});

app.on('window-all-closed', () => {
  discordRPC.destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  gameWatcher.stop();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Window control handlers (custom title bar buttons)
ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow.close();
});

// Auto-update: usuário clicou em "Reiniciar e atualizar"
ipcMain.on('update-install', () => {
  autoUpdate.quitAndInstall();
});

// "Play": se o CS 1.6 foi detectado, abre o jogo de verdade através da
// Steam (steam://rungameid/10) — é a própria Steam que cuida do processo,
// então o launcher só fica "por cima" mostrando o overlay de carregamento.
// Se não foi detectado, mantém a simulação (ex.: pra outros jogos/mods).
ipcMain.on('launch-game', (event) => {
  event.reply('launch-status', { status: 'launching' });

  if (cs16Info.detected) {
    console.log('Lançando Counter-Strike 1.6 via Steam...');
    shell.openExternal(`steam://rungameid/${steamDetect.CS16_APPID}`).catch((err) => {
      console.error('[SteamDetect] Erro ao abrir via Steam:', err);
    });

    // Em vez de confiar só num timer, fica de fato observando o processo
    // do jogo no sistema — assim a gente sabe quando ele abre de verdade
    // (e quando fecha, pra voltar tudo ao normal).
    const processName = cs16Info.exePath
      ? path.basename(cs16Info.exePath)
      : (process.platform === 'win32' ? 'hl.exe' : 'hl');

    gameWatcher.start(processName, {
      onRunning: () => {
        console.log('[GameWatcher] Counter-Strike 1.6 está rodando.');
        sendToRenderer('game-status', { status: 'running' });
        discordRPC.setPlayingActivity();
      },
      onClosed: () => {
        console.log('[GameWatcher] Counter-Strike 1.6 foi fechado.');
        sendToRenderer('game-status', { status: 'closed' });
        updateDiscordToIdle();
        showMainWindow(); // traz o launcher de volta pra frente
      }
    });

    setTimeout(() => {
      event.reply('launch-status', { status: 'launched' });
      minimizeToBackground();
    }, 1500);
  } else {
    console.log('CS 1.6 não detectado — usando lançamento simulado.');
    // Example of real usage com um executável próprio:
    // const { exec } = require('child_process');
    // exec('"C:\\Path\\To\\Game.exe"');
    setTimeout(() => {
      event.reply('launch-status', { status: 'launched' });
      discordRPC.setPlayingActivity();
      minimizeToBackground();
    }, 2500);
  }
});

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Volta o Rich Presence do Discord pro estado normal (fora de jogo).
// discord-rpc.js precisa expor setIdleActivity() ou clearActivity() pra
// isso funcionar de fato — se nenhuma das duas existir, só avisa no log.
function updateDiscordToIdle() {
  if (typeof discordRPC.setIdleActivity === 'function') {
    discordRPC.setIdleActivity();
  } else if (typeof discordRPC.clearActivity === 'function') {
    discordRPC.clearActivity();
  } else {
    console.warn(
      '[DiscordRPC] discord-rpc.js não tem setIdleActivity() nem clearActivity() — ' +
      'adicione uma dessas funções lá pra atualizar o rich presence quando o jogo fechar.'
    );
  }
}

// Manda o launcher pro segundo plano assim que o jogo inicia — esconde
// a janela de fato (não fica nem na barra de tarefas) e deixa o ícone
// na bandeja do sistema disponível pra reabrir quando quiser.
function minimizeToBackground() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}
