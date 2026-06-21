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
        const out = execSync(q, { encoding: 'utf8', windowsHide: true });
        const match = out.match(/REG_SZ\s+(.+)/);
        if (match) return match[1].trim();
      } catch (_) {
        // chave não existe nesse local, tenta a próxima
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
    const exeName = process.platform === 'win32' ? 'hl.exe' : 'hl';
    const exePath = path.join(gameDir, exeName);

    return {
      detected: true,
      steamPath,
      installPath: gameDir,
      exePath: fs.existsSync(exePath) ? exePath : null
    };
  }

  return { detected: false, reason: 'app-not-installed', steamPath };
}

module.exports = { detectCS16, CS16_APPID };
