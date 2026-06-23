// ===== App version (package.json via main process) =====
window.api.getVersion().then((version) => {
  const versionEl = document.getElementById('app-version');
  if (version && versionEl) versionEl.textContent = `LAUNCHER V${version}`;
});

// ===== Window controls =====
document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.api.close());

// Tira o arredondamento das bordas quando a janela está maximizada
// (senão fica com cantos transparentes estranhos colados na tela)
const windowFrame = document.getElementById('window-frame');
window.api.onWindowState((data) => {
  windowFrame.classList.toggle('maximized', data.maximized);
});

// ===== Sidebar navigation (visual state only — plug in real views as needed) =====
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  });
});

// ===== Play button =====
const overlay = document.getElementById('launch-overlay');
const launchText = document.getElementById('launch-text');
const btnPlay = document.getElementById('btn-play');
const btnPlayLabel = document.getElementById('btn-play-label');
const btnPlayArrow = document.getElementById('btn-play-arrow');

// Opções de inicialização — dois "modos" de exibição:
// 1) detectado (Steam ou caminho manual): botão com dropdown pra trocar
// 2) não detectado: painel fixo, sempre visível, com botão de seleção
//    manual e os links de download
const btnOptions = document.getElementById('btn-options');
const launchOptionText = document.getElementById('launch-option-text');
const optionsMenu = document.getElementById('launch-options-menu');
const lomChangePath = document.getElementById('lom-change-path');

const noGamePanel = document.getElementById('no-game-panel');
const lomBrowse = document.getElementById('lom-browse');
const lomLinkSteam = document.getElementById('lom-link-steam');
const lomLinkSecondary = document.getElementById('lom-link-secondary');

btnPlay.addEventListener('click', () => {
  if (btnPlay.disabled) return; // ainda verificando a instalação
  overlay.classList.remove('hidden');
  launchText.textContent = 'Iniciando o jogo...';
  window.api.launchGame();
});

window.api.onLaunchStatus((data) => {
  if (data.status === 'launching') {
    launchText.textContent = 'Iniciando o jogo...';
  } else if (data.status === 'launched') {
    launchText.textContent = 'Jogo iniciado!';
    setTimeout(() => overlay.classList.add('hidden'), 1200);
  }
});

// Abre/fecha o dropdown (só existe quando o jogo está detectado).
// O menu vive fora da .hero (que tem overflow:hidden + altura fixa),
// então a posição é calculada na mão a partir do botão, toda vez que abre.
function positionOptionsMenu() {
  const rect = btnOptions.getBoundingClientRect();
  optionsMenu.style.left = rect.left + 'px';
  optionsMenu.style.top = (rect.bottom + 6) + 'px';
  optionsMenu.style.width = rect.width + 'px';
}

btnOptions.addEventListener('click', (e) => {
  e.preventDefault();
  const opening = optionsMenu.classList.contains('hidden');
  if (opening) positionOptionsMenu();
  optionsMenu.classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!optionsMenu.classList.contains('hidden') &&
      !optionsMenu.contains(e.target) && e.target !== btnOptions && !btnOptions.contains(e.target)) {
    optionsMenu.classList.add('hidden');
  }
});
// Reposiciona (ou fecha) se a janela for redimensionada/maximizada
// enquanto o menu estiver aberto, pra não ficar desalinhado.
window.addEventListener('resize', () => {
  if (!optionsMenu.classList.contains('hidden')) positionOptionsMenu();
});

// "Escolher outro executável" (quando já tem algo detectado) e
// "Selecionar executável" (quando nada foi detectado) levam ao mesmo
// diálogo nativo de arquivo, no main process.
async function browseForExecutable() {
  const result = await window.api.browseGameExecutable();
  if (result && result.canceled) return;
  optionsMenu.classList.add('hidden');
  // onGameDetected é disparado pelo main process com o novo estado —
  // não precisa atualizar nada manualmente aqui.
}
lomChangePath.addEventListener('click', browseForExecutable);
lomBrowse.addEventListener('click', browseForExecutable);

// Links de download (Steam / link secundário opcional) — abrem no
// navegador padrão via main process, que valida a URL antes de abrir.
lomLinkSteam.addEventListener('click', (e) => {
  e.preventDefault();
  if (lomLinkSteam.dataset.url) window.api.openExternalLink(lomLinkSteam.dataset.url);
});
lomLinkSecondary.addEventListener('click', (e) => {
  e.preventDefault();
  if (lomLinkSecondary.dataset.url) window.api.openExternalLink(lomLinkSecondary.dataset.url);
});

// ===== Detecção automática (Steam ou caminho manual) do CS 1.6 =====
// Enquanto a checagem roda (lá no main process), o botão fica em estado
// "verificando" — desabilitado, com spinner e texto cinza. Quando o
// resultado chega, ele libera: verde se achou o jogo (qualquer fonte),
// ou mostra o painel de "nenhuma instalação encontrada" caso contrário.
window.api.onGameDetected((data) => {
  btnPlay.disabled = false;
  btnPlay.classList.remove('is-checking');
  btnPlayArrow.classList.remove('hidden-arrow');
  btnPlayLabel.textContent = 'JOGAR';

  if (data.detected) {
    btnPlay.classList.add('steam-ready');
    btnOptions.classList.remove('hidden');
    btnOptions.classList.add('steam-selected');
    noGamePanel.classList.add('hidden');

    launchOptionText.textContent = data.source === 'manual'
      ? 'EXECUTÁVEL CONFIGURADO MANUALMENTE'
      : 'STEAM — COUNTER-STRIKE 1.6 DETECTADO';
  } else {
    btnPlay.classList.remove('steam-ready');
    btnOptions.classList.add('hidden');
    btnOptions.classList.remove('steam-selected');
    optionsMenu.classList.add('hidden');
    noGamePanel.classList.remove('hidden');

    const links = data.links || {};
    if (links.steam) {
      lomLinkSteam.dataset.url = links.steam;
      lomLinkSteam.classList.remove('hidden');
    } else {
      lomLinkSteam.classList.add('hidden');
    }
    if (links.secondary) {
      lomLinkSecondary.dataset.url = links.secondary;
      lomLinkSecondary.textContent = 'Outro link ↗';
      lomLinkSecondary.classList.remove('hidden');
    } else {
      lomLinkSecondary.classList.add('hidden');
    }
  }
});

// ===== Jogo abriu / fechou (observado de verdade pelo main process) =====
// Enquanto o jogo está rodando, o botão fica num terceiro estado: travado,
// com uma bolinha pulsando e texto "JOGANDO". Quando o jogo fecha, volta
// pro estado normal (verde, já que sabemos que o jogo está instalado).
window.api.onGameStatus((data) => {
  if (data.status === 'running') {
    btnPlay.disabled = true;
    btnPlay.classList.remove('steam-ready');
    btnPlay.classList.add('in-game');
    btnPlayArrow.classList.add('hidden-arrow');
    btnPlayLabel.textContent = 'JOGANDO';
    launchOptionText.textContent = 'JOGO EM EXECUÇÃO';
  } else if (data.status === 'closed') {
    btnPlay.disabled = false;
    btnPlay.classList.remove('in-game');
    btnPlay.classList.add('steam-ready');
    btnPlayArrow.classList.remove('hidden-arrow');
    btnPlayLabel.textContent = 'JOGAR';
    launchOptionText.textContent = 'STEAM — COUNTER-STRIKE 1.6 DETECTADO';
  }
});

// ===== Auto-update bar =====
const updateBar = document.getElementById('update-bar');
const updateText = document.getElementById('update-text');
const updateProgressWrap = document.getElementById('update-progress-wrap');
const updateProgress = document.getElementById('update-progress');
const btnUpdateInstall = document.getElementById('btn-update-install');

btnUpdateInstall.addEventListener('click', () => {
  window.api.installUpdate();
});

window.api.onUpdateStatus((data) => {
  switch (data.status) {
    case 'checking':
      // Fica em silêncio — não precisa incomodar o usuário só de checar
      break;

    case 'available':
      updateBar.classList.remove('hidden');
      updateText.textContent = `Nova versão ${data.version} encontrada, baixando...`;
      updateProgressWrap.classList.remove('hidden');
      break;

    case 'downloading':
      updateBar.classList.remove('hidden');
      updateText.textContent = `Baixando atualização... ${data.percent}%`;
      updateProgressWrap.classList.remove('hidden');
      updateProgress.style.width = data.percent + '%';
      break;

    case 'downloaded':
      updateBar.classList.remove('hidden');
      updateText.textContent = `Atualização ${data.version} baixada e pronta para instalar.`;
      updateProgressWrap.classList.add('hidden');
      btnUpdateInstall.classList.remove('hidden');
      break;

    case 'not-available':
      updateBar.classList.add('hidden');
      break;

    case 'error':
      updateBar.classList.remove('hidden');
      updateText.textContent = 'Não foi possível verificar atualizações.';
      updateProgressWrap.classList.add('hidden');
      console.error('[AutoUpdate]', data.message);
      break;
  }
});