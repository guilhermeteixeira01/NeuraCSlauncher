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
const LAUNCH_TIMEOUT_MS = 120000; // 2 minutos — Steam pode demorar pra validar/abrir na 1ª vez

let pollHandle = null;
let isRunning = false;
let waitedMs = 0;

function isProcessRunning(processName) {
  return new Promise((resolve) => {
    if (!processName) return resolve({ running: false, pid: null });

    if (process.platform === 'win32') {
      // /FO CSV pra conseguir extrair o PID (2ª coluna) de forma confiável,
      // em vez de tentar parsear a saída de texto alinhado por espaços.
      exec(`tasklist /FI "IMAGENAME eq ${processName}" /FO CSV /NH`, (err, stdout) => {
        if (err) {
          console.warn('[GameWatcher] tasklist falhou:', err.message);
          return resolve({ running: false, pid: null });
        }
        const line = stdout.split('\n').find(l => l.toLowerCase().includes(processName.toLowerCase()));
        if (!line) return resolve({ running: false, pid: null });

        // Linha típica: "hl.exe","1234","Console","1","50,000 K"
        const columns = line.split('","').map(c => c.replace(/"/g, '').trim());
        const pid = columns[1] ? parseInt(columns[1], 10) : null;
        resolve({ running: true, pid: Number.isFinite(pid) ? pid : null });
      });
    } else {
      exec(`pgrep -x ${processName}`, (err, stdout) => {
        if (err || !stdout.trim()) return resolve({ running: false, pid: null });
        const pid = parseInt(stdout.trim().split('\n')[0], 10);
        resolve({ running: true, pid: Number.isFinite(pid) ? pid : null });
      });
    }
  });
}

/**
 * @param {string} processName ex.: "hl.exe" no Windows, "hl" no Linux/Mac
 * @param {{ onRunning: (pid: number|null) => void, onClosed: () => void }} callbacks
 */
function start(processName, { onRunning, onClosed }) {
  stop(); // garante que não fica mais de um watcher ativo ao mesmo tempo

  console.log(`[GameWatcher] Observando processo "${processName}"...`);

  isRunning = false;
  waitedMs = 0;

  pollHandle = setInterval(async () => {
    const { running, pid } = await isProcessRunning(processName);

    if (running && !isRunning) {
      console.log(`[GameWatcher] "${processName}" detectado rodando (PID ${pid}).`);
      isRunning = true;
      waitedMs = 0;
      onRunning(pid);
    } else if (!running && isRunning) {
      console.log(`[GameWatcher] "${processName}" não está mais rodando — jogo fechado.`);
      isRunning = false;
      stop();
      onClosed();
    } else if (!running && !isRunning) {
      waitedMs += POLL_INTERVAL_MS;
      if (waitedMs >= LAUNCH_TIMEOUT_MS) {
        console.log(
          `[GameWatcher] "${processName}" não apareceu em ${LAUNCH_TIMEOUT_MS / 1000}s, parei de verificar. ` +
          'Se o jogo realmente abriu, o nome do processo pode ser diferente do esperado.'
        );
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