/**
 * Launch Config
 * -------------
 * Guarda em disco (pasta de dados do app) as preferências de
 * inicialização que não vêm da detecção automática da Steam:
 *
 * - customGamePath: caminho de um executável escolhido manualmente
 *   pelo usuário (útil quando ele tem o CS 1.6 instalado por outra
 *   via que não a Steam, e a detecção automática não achou nada).
 * - secondaryLink: um segundo link opcional pra mostrar na tela de
 *   "nenhum jogo encontrado", além do link oficial da Steam. Fica
 *   vazio por padrão — só aparece na interface quando preenchido.
 */

const fs = require('fs');
const path = require('path');

const STEAM_STORE_URL = 'https://store.steampowered.com/app/10/CounterStrike/';

let configPath = null;
let cache = {
  customGamePath: null,
  secondaryLink: 'https://www.csrevo.com' // <- coloque aqui outro link, se quiser (ex.: 'https://...')
};

function init(app) {
  configPath = path.join(app.getPath('userData'), 'launch-config.json');
  load();
}

function load() {
  if (!configPath) return;
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = { ...cache, ...parsed };
    }
  } catch (err) {
    console.warn('[LaunchConfig] Falha ao ler config, usando padrão:', err.message);
  }
}

function save() {
  if (!configPath) return;
  try {
    fs.writeFileSync(configPath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.warn('[LaunchConfig] Falha ao salvar config:', err.message);
  }
}

function getCustomGamePath() {
  return cache.customGamePath || null;
}

function setCustomGamePath(p) {
  cache.customGamePath = p || null;
  save();
}

function clearCustomGamePath() {
  cache.customGamePath = null;
  save();
}

function getLinks() {
  return {
    steam: STEAM_STORE_URL,
    // Só vai pra interface se tiver algo preenchido em cache.secondaryLink
    secondary: cache.secondaryLink || null
  };
}

function setSecondaryLink(url) {
  cache.secondaryLink = url || '';
  save();
}

module.exports = {
  init,
  getCustomGamePath,
  setCustomGamePath,
  clearCustomGamePath,
  getLinks,
  setSecondaryLink,
  STEAM_STORE_URL
};
