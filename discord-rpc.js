/**
 * Discord Rich Presence
 * ----------------------
 * Mostra o status do launcher/jogo no perfil do Discord do usuário
 * (ex: "Jogando Vanguard 2 — No menu principal").
 *
 * Requisitos:
 * 1. Criar uma aplicação em https://discord.com/developers/applications
 * 2. Copiar o "Application ID" (Client ID) e colocar em CLIENT_ID abaixo
 *    (ou na variável de ambiente DISCORD_CLIENT_ID).
 * 3. Em "Rich Presence > Art Assets", subir as imagens que você quiser
 *    usar como large_image / small_image (os nomes precisam bater com
 *    as keys usadas em setActivity, ex: "logo_grande").
 * 4. O usuário precisa estar com o Discord desktop aberto para o status aparecer.
 */

const RPC = require('@xhayper/discord-rpc');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1518020991132106946';

const client = new RPC.Client({ clientId: CLIENT_ID });

let ready = false;
let connecting = false;
const startTimestamp = new Date();

/**
 * Fontes conhecidas de thumbnail de mapa (sites famosos, não algo que
 * você hospeda). Testadas nessa ordem — a primeira que responder com uma
 * imagem de verdade é usada. Se nenhuma tiver o mapa (bem comum em mapas
 * custom de mod, tipo os de Zombie Plague), cai pro logo do jogo mesmo,
 * automaticamente, sem precisar de lista nem configuração manual.
 *
 * - GameTracker: o site mais tradicional de listagem de servidores
 *   GoldSrc/Source, mantém uma base de thumbnails 160x120 por mapa.
 *   Cobre bem mapas oficiais/populares (de_dust2, cs_office, etc.);
 *   não costuma ter mapas custom de comunidade.
 *
 * Se um dia você quiser adicionar sua própria fonte (self-hosted ou
 * outro site), é só acrescentar outra entrada na lista retornada por
 * buildImageCandidates — a checagem e o fallback continuam funcionando
 * do mesmo jeito.
 */
function buildImageCandidates(map) {
  const safeName = map.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!safeName) return [];
  return [
    `https://image.gametracker.com/images/maps/160x120/cs/${safeName}.jpg`,
  ];
}

// Fallback caso um mapa não tenha imagem própria (ainda usa o asset
// "logo" tradicional, subido no portal).
const FALLBACK_LARGE_IMAGE_KEY = 'logo';

const https = require('https');

/**
 * Confere via HEAD se a URL realmente responde com uma imagem (200 +
 * content-type image/*). Timeout curto pra não travar o status do
 * Discord esperando um site lento/fora do ar.
 */
function checkImageUrl(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    try {
      const req = https.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
        const ok = res.statusCode === 200 && (res.headers['content-type'] || '').startsWith('image/');
        res.resume();
        resolve(ok);
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
      req.end();
    } catch (_) {
      resolve(false);
    }
  });
}

// Cache em memória (dura a sessão do launcher) pra não ficar checando o
// mesmo mapa toda hora que o A2S_INFO responde de novo (a cada ~10s).
const mapImageCache = new Map(); // nome do mapa (lowercase) -> Promise<string|null>

/**
 * Resolve a URL de imagem do mapa testando as fontes conhecidas, ou
 * retorna null se nenhuma tiver esse mapa (cai pro logo).
 */
function resolveMapImageUrl(map) {
  if (!map) return Promise.resolve(null);
  const key = map.trim().toLowerCase();
  if (mapImageCache.has(key)) return mapImageCache.get(key);

  const promise = (async () => {
    for (const url of buildImageCandidates(map)) {
      if (await checkImageUrl(url)) return url;
    }
    return null;
  })();

  mapImageCache.set(key, promise);
  return promise;
}

async function connect() {
  if (ready || connecting) return;

  if (!CLIENT_ID || CLIENT_ID === 'SEU_CLIENT_ID_AQUI') {
    console.warn(
      '[DiscordRPC] CLIENT_ID não configurado! Edite discord-rpc.js e coloque o ' +
      'Application ID criado em https://discord.com/developers/applications. ' +
      'Sem isso, a conexão sempre vai dar timeout.'
    );
    return;
  }

  connecting = true;
  console.log('[DiscordRPC] Tentando conectar com CLIENT_ID:', CLIENT_ID);
  try {
    await client.login();
  } catch (err) {
    console.error('[DiscordRPC] Falha ao conectar:', err);
    connecting = false;
    // Tenta de novo em 15s (ex: usuário abriu o Discord depois do launcher)
    setTimeout(connect, 15000);
  }
}

client.on('ready', () => {
  ready = true;
  connecting = false;
  console.log('[DiscordRPC] Conectado como', client.user?.username);
  setMenuActivity();
});

client.on('disconnected', () => {
  ready = false;
  console.log('[DiscordRPC] Desconectado, tentando reconectar...');
  setTimeout(connect, 10000);
});

/**
 * Status: parado no menu do launcher
 */
function setMenuActivity() {
  if (!ready) return;
  client.user?.setActivity({
    details: 'No menu principal',
    state: 'Launcher aberto',
    startTimestamp,
    largeImageKey: 'logo',
    largeImageText: 'No menu',
    smallImageKey: 'null',
    smallImageText: 'No menu',
    instance: false,
  }).catch(err => console.error('[DiscordRPC] setActivity falhou:', err.message));
}

/**
 * Status: jogo sendo iniciado / em partida (fallback genérico, usado
 * assim que o processo abre, antes de sabermos em qual servidor está, ou
 * se o servidor não respondeu à query de detalhes)
 */
function setPlayingActivity() {
  if (!ready) return;
  client.user?.setActivity({
    details: 'No CS',
    state: 'Menu',
    startTimestamp: new Date(),
    largeImageKey: 'logo',
    largeImageText: 'jogando',
    smallImageKey: 'null',
    smallImageText: '',
    instance: false,
  }).catch(err => console.error('[DiscordRPC] setActivity falhou:', err.message));
}

// Guarda a última info de servidor conhecida, só pra ter contexto (ex:
// mostrar "estava no de_dust" no log) quando cai a conexão.
let lastServerInfo = null;

/**
 * Status: dados reais do servidor em que o jogador está conectado
 * (nome do servidor, mapa atual e contagem de jogadores), obtidos pelo
 * server-watcher.js via consulta A2S_INFO.
 *
 * @param {{ name?: string, map?: string, players?: number, maxPlayers?: number }} info
 */
async function setServerActivity(info) {
  lastServerInfo = info;
  if (!ready) return;

  const map = info.map || null;
  const serverName = info.name || null;
  const hasPlayerCount = Number.isFinite(info.players) && Number.isFinite(info.maxPlayers);
  const mapImageUrl = await resolveMapImageUrl(map);

  // Enquanto isso esperava a checagem de imagem, pode ter chegado uma
  // atualização mais nova (outro poll) ou o jogador desconectou — não
  // aplica um status desatualizado por cima do que já é mais recente.
  if (lastServerInfo !== info || !ready) return;

  // Botão "Conectar" com o IP:porta do servidor via protocolo da Steam —
  // some_body vê no PERFIL de quem tá jogando (não aparece no seu
  // próprio status, isso é uma limitação do próprio Discord) e, ao
  // clicar, a Steam abre e tenta conectar direto nesse servidor.
  const connectUrl = (info.ip && info.port) ? `steam://connect/${info.ip}:${info.port}` : null;

  client.user?.setActivity({
    details: map ? `Mapa: ${map}` : 'Em partida',
    state: hasPlayerCount
      ? `${info.players}/${info.maxPlayers}${serverName ? ' — ' + serverName : ''}`
      : (serverName || 'Competitivo'),
    startTimestamp,
    // Se tiver imagem do mapa configurada, usa ela como imagem grande
    // (URL https direta); senão cai pro asset "logo" de sempre.
    largeImageKey: mapImageUrl || FALLBACK_LARGE_IMAGE_KEY,
    largeImageText: map || serverName || 'Em partida',
    // O logo do jogo vira o "selo" pequeno no canto, já que o grande
    // agora é o mapa.
    smallImageKey: 'null',
    smallImageText: '',
    buttons: connectUrl ? [{ label: 'Conectar ao servidor', url: connectUrl }] : undefined,
    instance: false,
  }).catch(err => console.error('[DiscordRPC] setActivity falhou:', err.message));
}

/**
 * Status: jogador estava em um servidor e desconectou (caiu, saiu, deu
 * timeout na query A2S etc), mas o jogo ainda está aberto. Chame isso
 * assim que detectar que a conexão com o servidor caiu, pra tirar o
 * mapa/servidor antigo do status e voltar pra algo genérico.
 */
function setDisconnectedActivity() {
  const wasOn = lastServerInfo;
  lastServerInfo = null;
  if (!ready) return;

  client.user?.setActivity({
    details: 'Em partida',
    state: 'Desconectado do servidor',
    startTimestamp,
    largeImageKey: FALLBACK_LARGE_IMAGE_KEY,
    largeImageText: 'Jogando',
    smallImageKey: 'null',
    smallImageText: '',
    instance: false,
  }).catch(err => console.error('[DiscordRPC] setActivity falhou:', err.message));

  if (wasOn) {
    console.log('[DiscordRPC] Servidor desconectado, status atualizado.');
  }
}

function clearActivity() {
  lastServerInfo = null;
  if (!ready) return;
  client.user?.clearActivity().catch(() => {});
}

function destroy() {
  try { client.destroy(); } catch (_) {}
}

module.exports = {
  connect,
  setMenuActivity,
  setPlayingActivity,
  setServerActivity,
  setDisconnectedActivity,
  clearActivity,
  destroy,
};