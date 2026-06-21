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
const btnOptions = document.getElementById('btn-options');
const launchOptionText = document.getElementById('launch-option-text');

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

// ===== Detecção automática do CS 1.6 instalado via Steam =====
// Enquanto a checagem roda (lá no main process), o botão fica em estado
// "verificando" — desabilitado, com spinner e texto cinza. Quando o
// resultado chega, ele libera: verde se achou o jogo, laranja padrão
// se não achou (e a opção de inicialização avisa o que foi detectado).
window.api.onGameDetected((data) => {
  btnPlay.disabled = false;
  btnPlay.classList.remove('is-checking');
  btnPlayArrow.classList.remove('hidden-arrow');
  btnPlayLabel.textContent = 'JOGAR';

  if (data.detected) {
    btnPlay.classList.add('steam-ready');
    btnOptions.classList.add('steam-selected');
    launchOptionText.textContent = 'STEAM — COUNTER-STRIKE 1.6 DETECTADO';
  } else {
    btnPlay.classList.remove('steam-ready');
    btnOptions.classList.remove('steam-selected');
    launchOptionText.textContent = 'OPÇÕES DE INICIALIZAÇÃO';
  }
});

// ===== Jogo abriu / fechou (observado de verdade pelo main process) =====
// Enquanto o jogo está rodando, o botão fica num terceiro estado: travado,
// com uma bolinha pulsando e texto "JOGANDO". Quando o jogo fecha, volta
// pro estado normal (verde, já que sabemos que o CS 1.6 está instalado).
window.api.onGameStatus((data) => {
  if (data.status === 'running') {
    btnPlay.disabled = true;
    btnPlay.classList.remove('steam-ready');
    btnPlay.classList.add('in-game');
    btnPlayArrow.classList.add('hidden-arrow');
    btnPlayLabel.textContent = 'JOGANDO';
    launchOptionText.textContent = 'STEAM — JOGO EM EXECUÇÃO';
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
