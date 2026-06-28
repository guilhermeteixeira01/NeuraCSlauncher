/**
 * Steam Detect — Counter-Strike 1.6
 * ----------------------------------
 * Detecta se o Counter-Strike 1.6 (appid 10 na Steam) está instalado
 * na máquina do usuário, sem depender de nenhum pacote externo.
 *
 * Fluxo:
 * 1. Acha a pasta de instalação da Steam (registro no Windows,
 *    caminhos padrão no macOS/Linux).
 * 2. Lê "steamapps/libraryfolders.vdf" pra achar TODAS as bibliotecas
 *    (o usuário pode ter o jogo instalado num HD diferente do padrão).
 * 3. Procura "steamapps/appmanifest_10.acf" em cada biblioteca — esse
 *    arquivo só existe se o jogo estiver instalado.
 * 4. Confirma o caminho do executável (hl.exe / hl).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CS16_APPID = '10'; // Counter-Strike 1.6 clássico na Steam

function getSteamInstallPath() {
  const platform = process.platform;

  if (platform === 'win32') {
    const queries = [
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
      'reg query "HKLM\\SOFTWARE\\Valve\\Steam" /v InstallPath'
    ];
    for (const q of queries) {
      try {
        const out = execSync(q, { encoding: 'utf8', windowsHide: true, timeout: 3000 });
        const match = out.match(/REG_SZ\s+(.+)/);
        if (match) return match[1].trim();
      } catch (_) {
        // chave não existe nesse local (ou demorou demais), tenta a próxima
      }
    }
    return null;
  }

  if (platform === 'darwin') {
    const p = path.join(os.homedir(), 'Library', 'Application Support', 'Steam');
    return fs.existsSync(p) ? p : null;
  }

  // Linux (inclui instalação via Flatpak)
  const candidates = [
    path.join(os.homedir(), '.local', 'share', 'Steam'),
    path.join(os.homedir(), '.steam', 'steam'),
    path.join(os.homedir(), '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Confirma se um executável é REALMENTE o Counter-Strike 1.6, e não outro
 * mod/jogo que também roda em cima da engine GoldSrc (Half-Life puro,
 * Day of Defeat, Team Fortress Classic, etc. — todos usam hl.exe/hl).
 *
 * Critérios, em ordem:
 * 1. O nome do arquivo precisa ser "hl.exe"/"cs.exe" (Windows) ou "hl"/"cs"
 *    (Linux/macOS) — launchers usados pelo CS 1.6 (alguns repacks usam
 *    "cs.exe" em vez do "hl.exe" padrão da engine).
 * 2. Na mesma pasta do executável precisa existir uma subpasta "cstrike"
 *    (é o gamedir do Counter-Strike — implícito pelo nome da pasta, já que
 *    o liblist.gam nem sempre declara isso explicitamente; outros mods
 *    usam outras pastas: "dod", "tfc", "valve", etc.).
 * 3. Dentro de "cstrike" precisa existir "liblist.gam" cujo campo "game"
 *    pareça com "Counter-Strike"/"CS" (aceita variações de rebranding de
 *    repacks não-oficiais, ex.: "CS 1.6 Revolution"), e cujo "gamedll"
 *    (quando presente) não aponte pra outro mod (ex.: "dod.dll", "tfc.so").
 *    É a forma mais confiável de descartar instalações "fake" (pasta
 *    cstrike vazia, renomeada, ou de outro jogo).
 *
 * @param {string} exePath - caminho completo para o executável a validar
 * @returns {{ valid: boolean, reason?: string, gameDir?: string, detectedGame?: string|null }}
 */
function isValidCS16Executable(exePath) {
  try {
    if (!exePath || typeof exePath !== 'string') {
      return { valid: false, reason: 'invalid-path' };
    }
    if (!fs.existsSync(exePath)) {
      return { valid: false, reason: 'file-not-found' };
    }
    if (!fs.statSync(exePath).isFile()) {
      return { valid: false, reason: 'not-a-file' };
    }

    const exeName = path.basename(exePath).toLowerCase();
    // Algumas instalações (principalmente não-Steam/standalone mais antigas)
    // usam "cs.exe" como launcher em vez do "hl.exe" padrão da engine.
    // Aceita os dois — a checagem de pasta "cstrike" + liblist.gam depois
    // é quem garante de fato que é o CS 1.6 e não outra coisa.
    const validNames = process.platform === 'win32'
      ? ['hl.exe', 'cs.exe']
      : ['hl', 'cs'];
    if (!validNames.includes(exeName)) {
      return { valid: false, reason: 'wrong-executable-name' };
    }

    const gameDir = path.dirname(exePath);
    const cstrikeDir = path.join(gameDir, 'cstrike');
    if (!fs.existsSync(cstrikeDir) || !fs.statSync(cstrikeDir).isDirectory()) {
      return { valid: false, reason: 'cstrike-folder-missing' };
    }

    const liblistPath = path.join(cstrikeDir, 'liblist.gam');
    if (!fs.existsSync(liblistPath)) {
      return { valid: false, reason: 'liblist-missing' };
    }

    let gameName = '';
    let gameDllField = '';
    try {
      const liblist = fs.readFileSync(liblistPath, 'utf8');
      // As aspas na CHAVE são opcionais dependendo de quem gerou o arquivo
      // (alguns liblist.gam usam game "Counter-Strike", outros "game"
      // "Counter-Strike") — por isso o "?\s* em volta da chave. A aspa no
      // VALOR essa sim é sempre obrigatória.
      const gameMatch = liblist.match(/"?game"?\s+"([^"]*)"/i);
      const gameDllMatch = liblist.match(/"?gamedll(?:_linux|_osx)?"?\s+"([^"]*)"/i);
      gameName = gameMatch ? gameMatch[1] : '';
      gameDllField = gameDllMatch ? gameDllMatch[1] : '';
    } catch (err) {
      return { valid: false, reason: 'liblist-unreadable' };
    }

    // O nome de exibição em "game" é o sinal principal. Aceita variações
    // como "Counter-Strike", "Counter Strike" (sem hífen) ou "CS 1.6" —
    // repacks/clientes não-oficiais (ex.: "CS Revolution") costumam
    // rebrandar esse texto, então não exige bater 100% com o oficial.
    const normalizedGame = gameName.toLowerCase().replace(/[\s-]+/g, '');
    const looksLikeCS = normalizedGame.includes('counterstrike') || /\bcs\b/i.test(gameName);
    // "gamedll" reforça a checagem quando existe: a dll do CS no
    // Linux/macOS sempre se chama "cs.so"/"cs.dylib" (diferente de outros
    // mods GoldSrc, como "dod.so" do Day of Defeat ou "tfc.so" do TFC).
    const dllLooksLikeCS = gameDllField === '' || /(^|[\\/])cs\.(so|dylib)$/i.test(gameDllField) || /mp\.dll$/i.test(gameDllField);

    if (!looksLikeCS || !dllLooksLikeCS) {
      return { valid: false, reason: 'not-counter-strike', detectedGame: gameName || null };
    }

    return { valid: true, gameDir, detectedGame: gameName || 'Counter-Strike' };
  } catch (err) {
    console.warn('[SteamDetect] Falha ao validar executável:', err.message);
    return { valid: false, reason: 'validation-error' };
  }
}

/**
 * Valida um caminho informado MANUALMENTE pelo usuário (ex: via diálogo
 * "selecionar pasta do jogo" ou input de texto). Aceita tanto o caminho
 * direto pro executável quanto o caminho da pasta de instalação do jogo
 * (nesse caso, completa com hl.exe/hl automaticamente).
 *
 * Use esta função sempre que o caminho vier do usuário, e NUNCA confie
 * apenas em "o arquivo existe" — sempre passe pelo isValidCS16Executable.
 *
 * @param {string} inputPath - caminho digitado/selecionado pelo usuário
 * @returns {{ valid: boolean, exePath?: string, reason?: string, detectedGame?: string|null }}
 */
function validateManualPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, reason: 'empty-path' };
  }

  let exePath = inputPath;

  try {
    if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
      const candidateNames = process.platform === 'win32'
        ? ['hl.exe', 'cs.exe']
        : ['hl', 'cs'];
      const found = candidateNames
        .map((name) => path.join(inputPath, name))
        .find((candidate) => fs.existsSync(candidate));
      // Se nenhum dos dois existir, mantém o primeiro nome como tentativa
      // padrão — isValidCS16Executable vai devolver 'file-not-found',
      // que é um motivo de rejeição mais claro que sumir sem explicação.
      exePath = found || path.join(inputPath, candidateNames[0]);
    }
  } catch (err) {
    return { valid: false, reason: 'path-check-error' };
  }

  const result = isValidCS16Executable(exePath);
  return { ...result, exePath };
}

function getLibraryFolders(steamPath) {
  const libraries = [steamPath];
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');

  if (!fs.existsSync(vdfPath)) return libraries;

  try {
    const content = fs.readFileSync(vdfPath, 'utf8');
    const regex = /"path"\s+"([^"]+)"/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const libPath = m[1].replace(/\\\\/g, '\\');
      if (!libraries.includes(libPath)) libraries.push(libPath);
    }
  } catch (err) {
    console.warn('[SteamDetect] Falha ao ler libraryfolders.vdf:', err.message);
  }

  return libraries;
}

/**
 * @returns {{ detected: boolean, steamPath?: string, installPath?: string, exePath?: string|null, reason?: string }}
 */
function detectCS16() {
  try {
    const steamPath = getSteamInstallPath();
    if (!steamPath) return { detected: false, reason: 'steam-not-found' };

    const libraries = getLibraryFolders(steamPath);

    for (const lib of libraries) {
      const manifestPath = path.join(lib, 'steamapps', `appmanifest_${CS16_APPID}.acf`);
      if (!fs.existsSync(manifestPath)) continue;

      let installDir = 'Half-Life';
      try {
        const manifest = fs.readFileSync(manifestPath, 'utf8');
        const m = manifest.match(/"installdir"\s+"([^"]+)"/);
        if (m) installDir = m[1];
      } catch (_) {
        // mantém o nome de pasta padrão
      }

      const gameDir = path.join(lib, 'steamapps', 'common', installDir);
      const candidateNames = process.platform === 'win32'
        ? ['hl.exe', 'cs.exe']
        : ['hl', 'cs'];
      const exePath = candidateNames
        .map((name) => path.join(gameDir, name))
        .find((candidate) => fs.existsSync(candidate)) || path.join(gameDir, candidateNames[0]);

      // Não basta o arquivo existir: confirma que é o CS 1.6 mesmo
      // (manifest da Steam corrompido/editado poderia levar pra outra pasta).
      const validation = isValidCS16Executable(exePath);

      return {
        detected: true,
        steamPath,
        installPath: gameDir,
        exePath: validation.valid ? exePath : null,
        exeValidationReason: validation.valid ? undefined : validation.reason
      };
    }

    return { detected: false, reason: 'app-not-installed', steamPath };
  } catch (err) {
    // Nunca deixa essa função explodir o processo principal — se algo
    // inesperado falhar (permissão, disco, etc.), devolve "não detectado"
    // em vez de travar o IPC e deixar o renderer esperando pra sempre.
    console.warn('[SteamDetect] Falha inesperada na detecção:', err.message);
    return { detected: false, reason: 'detect-error' };
  }
}

// Pastas que não vale a pena varrer: pastas de sistema (lentas, sem
// permissão, ou que nunca teriam um jogo) e pastas "armadilha" que podem
// ter milhares de arquivos (node_modules, cache, etc.) sem nenhuma chance
// de ter o CS 1.6 dentro.
const SCAN_SKIP_DIRS = new Set([
  'windows', '$recycle.bin', 'system volume information', 'programdata',
  'recovery', 'msocache', 'config.msi', 'perflogs', '$windows.~bt',
  '$windows.~ws', 'node_modules', 'appdata', 'intel', 'drivers',
  'winsxs', 'driverstore'
]);

const SCAN_MAX_DEPTH = 6;          // ex.: C:\Jogos\CS Revo\CS 1.6 2.4\cstrike já é depth 3
const SCAN_MAX_DIRS_VISITED = 15000;
const SCAN_TIME_BUDGET_MS = 8000;  // não deixa a varredura travar o app por muito tempo

function getScanRoots() {
  if (process.platform === 'win32') {
    const drives = [];
    for (const letter of 'CDEFGH') {
      const drive = `${letter}:\\`;
      if (fs.existsSync(drive)) drives.push(drive);
    }
    return drives;
  }
  if (process.platform === 'darwin') {
    return [os.homedir(), '/Applications'].filter((p) => fs.existsSync(p));
  }
  // Linux
  return [os.homedir(), '/home', '/mnt', '/media'].filter((p) => fs.existsSync(p));
}

/**
 * Varre pastas comuns do disco em busca de uma instalação do CS 1.6 que
 * NÃO esteja na Steam — repacks/clientes não-oficiais costumam ficar em
 * qualquer lugar (ex.: "C:\Jogos\CS Revo\CS 1.6 2.4"), então a detecção
 * via Steam (detectCS16) nunca acharia esses casos.
 *
 * É limitada de propósito (profundidade, tempo, pastas ignoradas) pra não
 * travar o app varrendo o disco inteiro — se não achar dentro do limite,
 * simplesmente desiste e devolve "não encontrado", sem erro.
 *
 * @param {string[]} [roots] - raízes pra varrer (default: drives/locais
 *   comuns do sistema operacional, ver getScanRoots()). Parametrizável
 *   principalmente pra testes.
 * @returns {{ found: boolean, exePath?: string, gameDir?: string }}
 */
function scanCommonLocations(roots) {
  const startedAt = Date.now();
  const exeNames = process.platform === 'win32' ? ['hl.exe', 'cs.exe'] : ['hl', 'cs'];
  const stack = (roots || getScanRoots()).map((root) => ({ dir: root, depth: 0 }));

  let dirsVisited = 0;

  while (stack.length > 0) {
    if (Date.now() - startedAt > SCAN_TIME_BUDGET_MS) break;
    if (dirsVisited > SCAN_MAX_DIRS_VISITED) break;

    const { dir, depth } = stack.pop();
    dirsVisited++;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue; // sem permissão, link quebrado, etc. — só pula essa pasta
    }

    // Confere se o jogo está NESTA pasta antes de gastar tempo descendo mais.
    const hasCstrike = entries.some((e) => e.isDirectory() && e.name.toLowerCase() === 'cstrike');
    if (hasCstrike) {
      for (const exeName of exeNames) {
        const candidate = path.join(dir, exeName);
        const validation = isValidCS16Executable(candidate);
        if (validation.valid) {
          return { found: true, exePath: candidate, gameDir: dir };
        }
      }
    }

    if (depth >= SCAN_MAX_DEPTH) continue;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nameLower = entry.name.toLowerCase();
      if (SCAN_SKIP_DIRS.has(nameLower)) continue;
      if (entry.name.startsWith('.')) continue; // pastas ocultas (.cache, .config, etc.)
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  return { found: false };
}

module.exports = {
  detectCS16,
  validateManualPath,
  isValidCS16Executable,
  scanCommonLocations,
  CS16_APPID
};