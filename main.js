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

// Combina a detecção automática da Steam, um caminho manual configurado
// pelo usuário, e — se nenhum dos dois achar nada — uma varredura de
// pastas comuns do disco (pra pegar repacks/clientes não-Steam, tipo
// "C:\Jogos\CS Revo\CS 1.6 2.4", sem o usuário precisar selecionar na mão).
// Prioridade: Steam > manual salvo > varredura automática.
function resolveCs16Info() {
  const steamResult = steamDetect.detectCS16();
  if (steamResult.detected) {
    return { ...steamResult, source: 'steam' };
  }

  const manualPath = launchConfig.getCustomGamePath();
  if (manualPath) {
    const validation = steamDetect.validateManualPath(manualPath);
    if (validation.valid) {
      return {
        detected: true,
        source: 'manual',
        exePath: validation.exePath,
        installPath: path.dirname(validation.exePath)
      };
    }

    // Caminho salvo não existe mais OU não é o CS 1.6 (ex.: usuário trocou
    // de jogo, moveu a pasta, ou a validação ficou mais estrita depois).
    // Em ambos os casos não dá pra confiar nele — limpa a config.
    console.warn('[CS16] Caminho manual configurado é inválido:', validation.reason);
    launchConfig.clearCustomGamePath();
  }

  // Nem Steam nem caminho manual — varre locais comuns do disco antes de
  // desistir. É limitada (tempo/profundidade, ver steam-detect.js) então
  // não trava o app, mas pode levar alguns segundos na primeira vez.
  console.log('[CS16] Steam e caminho manual não acharam nada — iniciando varredura automática...');
  const scanResult = steamDetect.scanCommonLocations();
  if (scanResult.found) {
    console.log('[CS16] Varredura automática encontrou o jogo em:', scanResult.exePath);
    // Salva como caminho manual pra não precisar varrer o disco de novo
    // a cada vez que o launcher abrir — a próxima checagem cai direto no
    // bloco de "caminho manual" acima, que é instantâneo.
    launchConfig.setCustomGamePath(scanResult.exePath);
    return {
      detected: true,
      source: 'auto-scan',
      exePath: scanResult.exePath,
      installPath: scanResult.gameDir
    };
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
    width: 1280,
    height: 780,
    minWidth: 1000,
    minHeight: 660,
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

  // Sempre que o conteúdo da janela termina de carregar — incluindo
  // recargas de desenvolvimento via electron-reload, não só o boot inicial —
  // manda o estado atual de detecção de novo. Sem isso, um reload no meio
  // do uso deixa o botão "JOGAR" preso pra sempre em "verificando...",
  // porque os listeners antigos do renderer morreram junto com a página
  // e ninguém avisa a página nova do que já tinha sido detectado.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('game-detected', { ...cs16Info, links: launchConfig.getLinks() });
  });

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

// ===== Anúncios =====
// Config do GitHub hardcodada — o painel admin roda no navegador (GitHub Pages)
// e não tem como escrever no userData do Electron, então a config fica aqui.
// Repositório: guilhermeteixeira01/NeuraCSLauncher
// Token opcional para repos públicos; adicione se o repo for privado.
const ANNOUNCEMENTS_GH_CONFIG = {
  owner:  'guilhermeteixeira01',
  repo:   'NeuraCSLauncher',
  path:   'src/announcements.json',
  branch: 'main',
  token:  '',
};

let announcementsCache = null;
let announcementsCacheTime = 0;
const ANNOUNCEMENTS_CACHE_TTL = 2 * 60 * 1000;

async function fetchAnnouncementsFromGitHub(cfg) {
  const { net } = require('electron');
  const ghPath = cfg.path || 'announcements.json';
  const branch = cfg.branch || 'main';
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${ghPath}?ref=${branch}`;

  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'GET', url,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'NeuraCS-Launcher',
        ...(cfg.token ? { 'Authorization': `token ${cfg.token}` } : {})
      }
    });
    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) { reject(new Error(`GitHub API: ${res.statusCode}`)); return; }
          const d = JSON.parse(body);
          const decoded = Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf8');
          resolve(JSON.parse(decoded));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

ipcMain.handle('get-announcements', async () => {
  const now = Date.now();
  if (announcementsCache && (now - announcementsCacheTime) < ANNOUNCEMENTS_CACHE_TTL) {
    return announcementsCache;
  }

  const cfg = ANNOUNCEMENTS_GH_CONFIG;
  if (cfg.owner && cfg.repo) {
    try {
      const data = await fetchAnnouncementsFromGitHub(cfg);
      announcementsCache = data;
      announcementsCacheTime = now;
      console.log(`[Announcements] ${data.announcements?.length ?? 0} anuncio(s) carregado(s) do GitHub.`);
      return data;
    } catch (err) {
      console.warn('[Announcements] Falha no GitHub, usando fallback local:', err.message);
    }
  }

  try {
    const localPath = path.join(__dirname, 'src', 'announcements.json');
    if (fs.existsSync(localPath)) {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      announcementsCache = data;
      announcementsCacheTime = now;
      return data;
    }
  } catch (err) {
    console.warn('[Announcements] Erro ao ler arquivo local:', err.message);
  }

  return { announcements: [] };
});

// Abre links de anúncios no navegador (sem allowlist, pois o conteúdo é
// controlado pelo admin do painel — config hardcodada em ANNOUNCEMENTS_GH_CONFIG).
ipcMain.on('open-announcement-link', (event, url) => {
  if (!url || typeof url !== 'string') return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.warn('[Announcements] URL rejeitada (não é http/https):', url);
    return;
  }
  shell.openExternal(url).catch((err) => {
    console.error('[Announcements] Erro ao abrir link:', err);
  });
});

// Abre o diálogo nativo de "escolher arquivo" pra o usuário apontar um
// executável do jogo (qualquer instalação que a detecção automática da
// Steam não tenha encontrado). Salva o caminho escolhido e refaz a
// detecção, avisando a tela de opções do novo estado.
// Traduz o "reason" técnico do steam-detect.js numa mensagem que faça
// sentido pra quem não programa, pra mostrar na caixa de mensagem nativa.
function describeRejection(reason) {
  const messages = {
    'file-not-found': 'O arquivo selecionado não foi encontrado.',
    'not-a-file': 'O caminho selecionado não é um arquivo.',
    'wrong-executable-name': 'Esse não é o executável do Counter-Strike 1.6 (hl.exe). Você selecionou outro jogo ou programa.',
    'cstrike-folder-missing': 'A pasta do jogo não tem a estrutura do Counter-Strike 1.6 (faltando a pasta "cstrike"). Verifique se escolheu o executável correto.',
    'liblist-missing': 'A pasta do jogo está incompleta (faltando arquivos do CS 1.6). Tente reinstalar ou verificar a integridade dos arquivos pela Steam.',
    'liblist-unreadable': 'Não foi possível ler os arquivos do jogo pra confirmar que é o CS 1.6.',
    'not-counter-strike': 'Esse executável pertence a outro jogo (não é o Counter-Strike 1.6).',
    'invalid-path': 'Caminho inválido.',
    'empty-path': 'Nenhum caminho foi selecionado.',
    'validation-error': 'Ocorreu um erro inesperado ao validar o executável.'
  };
  return messages[reason] || 'O executável selecionado não é o Counter-Strike 1.6.';
}

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

  // Valida ANTES de salvar — não basta o usuário ter escolhido um .exe
  // qualquer (o filtro do diálogo aceita qualquer .exe no Windows), ele
  // precisa ser o hl.exe/hl da pasta certa do CS 1.6 (ver steam-detect.js).
  const validation = steamDetect.validateManualPath(chosenPath);
  if (!validation.valid) {
    console.warn('[browse-game-executable] Executável rejeitado:', chosenPath, validation.reason);

    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Executável inválido',
      message: 'Não foi possível usar o arquivo selecionado',
      detail: describeRejection(validation.reason),
      buttons: ['OK']
    });

    return { canceled: false, rejected: true, reason: validation.reason, path: chosenPath };
  }

  launchConfig.setCustomGamePath(validation.exePath);
  const updated = refreshAndBroadcastDetection();
  return { canceled: false, path: validation.exePath, info: updated };
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