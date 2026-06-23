const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const discordRPC = require('./discord-rpc');
const autoUpdate = require('./auto-update');
const steamDetect = require('./steam-detect');
const gameWatcher = require('./game-watcher');
const launchConfig = require('./launch-config');

// Guarda o resultado da detecção do CS 1.6 pra usar depois, no clique de "JOGAR".
// "source" indica de onde veio: 'steam' (detecção automática) ou 'manual'
// (executável escolhido pelo usuário nas opções de inicialização).
let cs16Info = { detected: false };
let tray = null;
let splashWindow = null;
let mainWindowReady = false;
let splashPageReady = false;
let bootTransitionStarted = false;

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

// Combina a detecção automática da Steam com um caminho manual que o
// usuário possa ter configurado nas opções de inicialização. A Steam
// continua tendo prioridade quando os dois existem (é a fonte mais
// confiável); o manual só entra em ação se a Steam não achou nada.
function resolveCs16Info() {
  const steamResult = steamDetect.detectCS16();
  if (steamResult.detected) {
    return { ...steamResult, source: 'steam' };
  }

  const manualPath = launchConfig.getCustomGamePath();
  if (manualPath && fs.existsSync(manualPath)) {
    return {
      detected: true,
      source: 'manual',
      exePath: manualPath,
      installPath: path.dirname(manualPath)
    };
  }
  if (manualPath && !fs.existsSync(manualPath)) {
    // O arquivo que o usuário escolheu não existe mais (foi movido/apagado) —
    // limpa a config pra não ficar reportando um caminho morto.
    launchConfig.clearCustomGamePath();
  }

  return { detected: false, reason: steamResult.reason || 'app-not-installed' };
}

function refreshAndBroadcastDetection() {
  cs16Info = resolveCs16Info();
  sendToRenderer('game-detected', { ...cs16Info, links: launchConfig.getLinks() });
  return cs16Info;
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
    show: false, // fica escondida até a splash terminar (ver showMainWindowFromSplash)
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

// ===== Splash screen =====
// Janela pequena, sem moldura, que aparece assim que o app abre — enquanto
// a janela principal carrega de verdade em segundo plano (Discord RPC,
// checagem de update, detecção do CS 1.6). Sem ela, esses passos iniciais
// deixariam uma janela vazia/branca piscando por um instante.
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 460,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    hasShadow: true,
    show: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'src', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // sem isso a animação CSS "congela" num frame parado
                                   // enquanto a janela nasce escondida (show:false)
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'src', 'splash.html')).catch((err) => {
    console.error('[Splash] Erro ao carregar splash.html — pulando direto pra janela principal:', err);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  });

  splashWindow.webContents.once('did-finish-load', () => {
    splashPageReady = true;

    console.log("Splash carregada");

    setTimeout(() => {
        splashWindow.webContents.send(
            "splash-status",
            "Iniciando launcher..."
        );

        splashWindow.webContents.send(
            "splash-progress",
            15
        );

        splashWindow.webContents.send(
            "splash-version",
            app.getVersion()
        );
    },500);
  });

  splashWindow.once('ready-to-show', () => {
    console.log('[Splash] Pronta, exibindo.');
    splashWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-version', app.getVersion());
    }
  });

  splashWindow.on('closed', () => { splashWindow = null; });
}

function sendSplashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-status', text);
  }
}

function sendSplashProgress(pct) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-progress', pct);
  }
}

function waitForSplashPage() {
  return new Promise((resolve) => {
    if (splashPageReady) {
      resolve();
      return;
    }

    const check = setInterval(() => {
      if (splashPageReady) {
        clearInterval(check);
        resolve();
      }
    }, 16);

    setTimeout(() => {
      clearInterval(check);
      resolve();
    }, 5000);
  });
}

function waitForMainWindowLoad() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve();
      return;
    }

    if (!mainWindow.webContents.isLoading()) {
      resolve();
      return;
    }

    mainWindow.webContents.once('did-finish-load', () => resolve());
    setTimeout(resolve, 8000);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tempo alinhado com a transição CSS da barra (splash.html).
const PROGRESS_ANIM_MS = 420;
const STEP_HOLD_MS = 320;

async function runSplashStep(status, progress) {
  sendSplashStatus(status);

  // pequena pausa para atualizar o texto
  await delay(80);

  sendSplashProgress(progress);

  // espera a animação terminar
  await delay(900);
}

function showMainWindowFromSplash() {
  if (bootTransitionStarted) return;
  bootTransitionStarted = true;
  mainWindowReady = true;

  showMainWindow();

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-fade-out');
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    }, 320);
  }
}

async function runBootSequence() {
  await waitForSplashPage();
  await delay(120);

  await runSplashStep('Iniciando launcher...', 15);

  launchConfig.init(app);
  createWindow();
  createTray();

  await runSplashStep('Conectando ao Discord...', 35);
  discordRPC.connect();

  await runSplashStep('Verificando atualizações...', 58);
  autoUpdate.init(mainWindow);
  autoUpdate.checkForUpdates();

  await runSplashStep('Verificando instalação do jogo...', 78);
  try {
    cs16Info = resolveCs16Info();
  } catch (err) {
    console.error('[Detect] Erro ao detectar CS 1.6, seguindo sem detecção:', err);
    cs16Info = { detected: false, reason: 'detect-error' };
  }
  if (cs16Info.detected) {
    console.log(`[Detect] CS 1.6 encontrado (${cs16Info.source}):`, cs16Info.installPath || cs16Info.exePath);
  } else {
    console.log('[Detect] CS 1.6 não encontrado:', cs16Info.reason);
  }

  await runSplashStep('Carregando interface...', 92);
  await waitForMainWindowLoad();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('game-detected', { ...cs16Info, links: launchConfig.getLinks() });
  }

  await runSplashStep('Pronto!', 100);

  // deixa a barra terminar a animação
  await delay(1200);

  showMainWindowFromSplash();
}

app.whenReady().then(async () => {
  console.log('[Boot] app ready — criando splash...');
  createSplashWindow();

  const failsafeTimer = setTimeout(() => {
    if (!mainWindowReady) {
      console.warn('[Boot] Failsafe acionado — forçando exibição da janela principal.');
      showMainWindowFromSplash();
    }
  }, 20000);

  try {
    await runBootSequence();
    clearTimeout(failsafeTimer);
  } catch (err) {
    console.error('[Boot] Erro durante a inicialização — mostrando janela principal mesmo assim:', err);
    clearTimeout(failsafeTimer);
    showMainWindowFromSplash();
  }
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    mainWindow.once('ready-to-show', () => showMainWindow());
  }
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

// "Play": o comportamento muda de acordo com a fonte detectada em cs16Info.source:
// - 'steam'  -> abre via protocolo steam://rungameid/10 (a própria Steam cuida do processo)
// - 'manual' -> roda direto o executável que o usuário escolheu nas opções
// - nenhum   -> mantém a simulação (ex.: pra outros jogos/mods futuros)
ipcMain.on('launch-game', (event) => {
  event.reply('launch-status', { status: 'launching' });

  if (cs16Info.detected && cs16Info.source === 'manual') {
    console.log('Lançando executável configurado manualmente:', cs16Info.exePath);
    const { spawn } = require('child_process');
    try {
      const child = spawn(cs16Info.exePath, [], {
        cwd: path.dirname(cs16Info.exePath),
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (err) {
      console.error('[Launch] Erro ao iniciar executável manual:', err);
    }

    startWatchingGameProcess(path.basename(cs16Info.exePath));

    setTimeout(() => {
      event.reply('launch-status', { status: 'launched' });
      minimizeToBackground();
    }, 1500);
  } else if (cs16Info.detected) {
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

    startWatchingGameProcess(processName);

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

function startWatchingGameProcess(processName) {
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
}

ipcMain.handle('get-app-version', () => app.getVersion());

// Abre o diálogo nativo de "escolher arquivo" pra o usuário apontar um
// executável do jogo (qualquer instalação que a detecção automática da
// Steam não tenha encontrado). Salva o caminho escolhido e refaz a
// detecção, avisando a tela de opções do novo estado.
ipcMain.handle('browse-game-executable', async () => {
  const filters = process.platform === 'win32'
    ? [{ name: 'Executável', extensions: ['exe'] }]
    : [{ name: 'Executável', extensions: ['*'] }];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o executável do jogo',
    properties: ['openFile'],
    filters
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const chosenPath = result.filePaths[0];
  launchConfig.setCustomGamePath(chosenPath);
  const updated = refreshAndBroadcastDetection();
  return { canceled: false, path: chosenPath, info: updated };
});

// Esquece o caminho manual configurado (ex.: usuário quer escolher outro,
// ou voltar a depender só da detecção automática da Steam).
ipcMain.on('clear-game-executable', () => {
  launchConfig.clearCustomGamePath();
  refreshAndBroadcastDetection();
});

// Abre links externos (Steam, ou um segundo link configurado em
// launch-config.js) no navegador padrão do sistema.
ipcMain.on('open-external-link', (event, url) => {
  const allowed = Object.values(launchConfig.getLinks()).filter(Boolean);
  if (!allowed.includes(url)) {
    console.warn('[Links] Tentativa de abrir URL fora da lista permitida, ignorada:', url);
    return;
  }
  shell.openExternal(url).catch((err) => {
    console.error('[Links] Erro ao abrir link externo:', err);
  });
});

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Volta o Rich Presence do Discord pro estado normal (fora de jogo) —
// mesmo status de "No menu principal" que ele mostra logo que conecta.
// Prioriza setMenuActivity() (já existe no seu discord-rpc.js); se um dia
// esse arquivo mudar e ela não existir mais, cai pra clearActivity() e,
// por último, reconecta o client (sessão nova nasce sem activity nenhuma).
function updateDiscordToIdle() {
  if (typeof discordRPC.setMenuActivity === 'function') {
    discordRPC.setMenuActivity();
    return;
  }
  if (typeof discordRPC.setIdleActivity === 'function') {
    discordRPC.setIdleActivity();
    return;
  }
  if (typeof discordRPC.clearActivity === 'function') {
    discordRPC.clearActivity();
    return;
  }

  console.warn(
    '[DiscordRPC] discord-rpc.js não tem setMenuActivity()/setIdleActivity()/clearActivity() — ' +
    'usando fallback de reconexão.'
  );
  try {
    discordRPC.destroy();
    discordRPC.connect();
  } catch (err) {
    console.error('[DiscordRPC] Fallback de reconexão falhou:', err);
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