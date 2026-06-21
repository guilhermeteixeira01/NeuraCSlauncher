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
    state: 'Neura CS Launcher',
    startTimestamp,
    largeImageKey: 'logo',
    largeImageText: 'No menu',
    smallImageKey: 'null',
    smallImageText: 'No menu',
    instance: false,
  }).catch(err => console.error('[DiscordRPC] setActivity falhou:', err.message));
}

/**
 * Status: jogo sendo iniciado / em partida
 */
function setPlayingActivity() {
  if (!ready) return;
  client.user?.setActivity({
    details: 'Em partida',
    state: 'Competitivo',
    startTimestamp: new Date(),
    largeImageKey: 'logo',
    largeImageText: 'jogando',
    smallImageKey: 'logo',
    smallImageText: 'Jogando',
    instance: false,
  }).catch(err => console.error('[DiscordRPC] setActivity falhou:', err.message));
}

function clearActivity() {
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
  clearActivity,
  destroy,
};
