const fs = require('fs');
const path = require('path');

const STEAM_STORE_URL = 'https://store.steampowered.com/app/10/CounterStrike/';

let configPath = null;

let cache = {
  customGamePath: null,
  secondaryLink: 'https://www.csrevo.com',
  github: 'https://github.com/guilhermeteixeira01'
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
    secondary: cache.secondaryLink || null,
    github: cache.github || null
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