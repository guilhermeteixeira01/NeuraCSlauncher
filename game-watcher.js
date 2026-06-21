/**
 * Game Watcher
 * ------------
 * Fica de olho se o processo do jogo (hl.exe / hl) está rodando de
 * verdade no sistema. Como o lançamento é feito pela própria Steam
 * (steam://rungameid), a gente não tem o processo filho — então a
 * única forma confiável de saber se o jogo "abriu" e "fechou" é
 * checar a lista de processos do sistema periodicamente.
 *
 * Fluxo:
 * 1. start() começa a verificar a cada poucos segundos.
 * 2. Quando o processo aparece pela primeira vez -> onRunning()
 * 3. Quando o processo, que estava rodando, deixa de existir -> onClosed()
 * 4. Se o processo nunca aparecer dentro do tempo limite (o usuário pode
 *    ter cancelado no Steam, por exemplo), a checagem para sozinha.
 */

const { exec } = require('child_process');

const POLL_INTERVAL_MS = 2000;
const LAUNCH_TIMEOUT_MS = 45000; // tempo máx esperando o processo aparecer

let pollHandle = null;
let isRunning = false;
let waitedMs = 0;

function isProcessRunning(processName) {
  return new Promise((resolve) => {
    if (!processName) return resolve(false);

    if (process.platform === 'win32') {
      exec(`tasklist /FI "IMAGENAME eq ${processName}" /NH`, (err, stdout) => {
        if (err) return resolve(false);
        resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
      });
    } else {
      exec(`pgrep -x ${processName}`, (err, stdout) => {
        resolve(!err && stdout.trim().length > 0);
      });
    }
  });
}

/**
 * @param {string} processName ex.: "hl.exe" no Windows, "hl" no Linux/Mac
 * @param {{ onRunning: () => void, onClosed: () => void }} callbacks
 */
function start(processName, { onRunning, onClosed }) {
  stop(); // garante que não fica mais de um watcher ativo ao mesmo tempo

  isRunning = false;
  waitedMs = 0;

  pollHandle = setInterval(async () => {
    const running = await isProcessRunning(processName);

    if (running && !isRunning) {
      isRunning = true;
      waitedMs = 0;
      onRunning();
    } else if (!running && isRunning) {
      isRunning = false;
      stop();
      onClosed();
    } else if (!running && !isRunning) {
      waitedMs += POLL_INTERVAL_MS;
      if (waitedMs >= LAUNCH_TIMEOUT_MS) {
        console.log('[GameWatcher] Processo não detectado a tempo, parei de verificar.');
        stop();
      }
    }
  }, POLL_INTERVAL_MS);
}

function stop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

module.exports = { start, stop };
