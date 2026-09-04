/**
 * Server Watcher
 * --------------
 * Descobre a qual servidor o processo do jogo está conectado lendo o log
 * de console do próprio GoldSrc (qconsole.log), e consulta esse servidor
 * pelo protocolo A2S_INFO — o mesmo que sites de listagem de servidor
 * (GameTracker, etc.) usam pra pegar nome, mapa e contagem de jogadores.
 *
 * Por que não via netstat/UDP:
 * O hl.exe não chama connect() nos sockets UDP dele, então o SO nunca
 * expõe o endereço remoto via netstat (fica sempre "*:*") — não tem como
 * descobrir o servidor por aí. A engine, porém, imprime uma linha
 * "Connecting to IP:PORTA" no console toda vez que conecta em qualquer
 * servidor (pelo menu, console, ou lista do próprio launcher), e — com a
 * flag `-condebug` — essa saída é gravada em
 * "<pasta do jogo>/cstrike/qconsole.log". É essa linha que a gente lê.
 *
 * IMPORTANTE — pré-requisito:
 * - Lançamento MANUAL (executável escolhido pelo usuário): o próprio
 *   main.js já adiciona `-condebug -conclearlog` ao iniciar o processo,
 *   então funciona automaticamente.
 * - Lançamento via STEAM (steam://rungameid): a gente não controla os
 *   argumentos de linha de comando nesse caso — o usuário precisa
 *   adicionar `-condebug -conclearlog` nas "Opções de inicialização" do
 *   jogo na própria Steam (botão direito no jogo > Propriedades) UMA
 *   VEZ. Sem isso, o log não é criado/atualizado e esse watcher
 *   simplesmente não encontra nada — cai de volta no status genérico
 *   "Em partida" no Discord, sem travar nada.
 *
 * Detectando quando VOCÊ (e não o servidor) desconecta:
 * A2S_INFO responde enquanto o SERVIDOR estiver de pé, mesmo que você já
 * tenha saído dele (outros jogadores continuam lá). Só isso não é
 * suficiente pra saber que você desconectou. Por isso, além do A2S_INFO,
 * a gente também consulta o A2S_PLAYER (lista de jogadores conectados) e
 * confere se o SEU nome (lido do config.cfg/userconfig.cfg do jogo)
 * ainda está nela. Se o servidor responde mas seu nome sumiu da lista,
 * consideramos desconectado — mesmo com o servidor no ar.
 */

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

const POLL_INTERVAL_MS = 10000;
const QUERY_TIMEOUT_MS = 3000;
// Quantas consultas seguidas sem resposta até considerar que o jogador
// não está mais conectado a esse servidor (~ MAX_FAILS * POLL_INTERVAL_MS).
const MAX_CONSECUTIVE_FAILURES = 2;

const CONNECT_LINE_REGEX = /Connecting to (\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/gi;

// Onde procurar o nome do jogador configurado no próprio jogo (cvar
// "name"). userconfig.cfg é o mais confiável (só tem o que o usuário
// mudou manualmente); config.cfg é reescrito pelo motor a cada saída e
// serve de fallback.
const PLAYER_NAME_REGEX = /^\s*name\s+"([^"]*)"/im;

let pollHandle = null;
let watchedInstallPath = null;
let currentTarget = null; // { ip, port } — último servidor visto no log
let failureCount = 0;
let lastServerKey = null; // pra não repetir onNoServer()/log à toa
let localPlayerName = null; // nome do jogador local, lido uma vez por start()

function getLogPathCandidates(installPath) {
  return [
    path.join(installPath, 'cstrike', 'qconsole.log'), // local mais comum (pasta do mod)
    path.join(installPath, 'qconsole.log'),             // alguns builds gravam na raiz do jogo
  ];
}

/**
 * Acha, entre os caminhos possíveis, o qconsole.log que realmente existe.
 * Resolve de novo a cada chamada (é barato — só um fs.existsSync) porque
 * o arquivo pode não existir ainda no primeiro poll e aparecer depois.
 */
function resolveLogPath(installPath) {
  const candidates = getLogPathCandidates(installPath);
  return candidates.find(p => fs.existsSync(p)) || candidates[0]; // sem nenhum achado, usa o mais comum (só pra log de erro fazer sentido)
}

/**
 * Lê o nome do jogador configurado no jogo (cvar "name"), procurando
 * primeiro em userconfig.cfg e depois em config.cfg dentro de "cstrike".
 * Retorna null se não achar nenhum dos dois arquivos ou a cvar não
 * estiver setada — nesse caso a checagem de presença na A2S_PLAYER é
 * pulada e o código volta a confiar só no A2S_INFO (comportamento antigo).
 */
function getLocalPlayerName(installPath) {
  const candidates = [
    path.join(installPath, 'cstrike', 'userconfig.cfg'),
    path.join(installPath, 'cstrike', 'config.cfg'),
  ];

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(PLAYER_NAME_REGEX);
      if (match && match[1] && match[1].trim()) {
        return match[1].trim();
      }
    } catch (_) {
      // arquivo não existe ou não pôde ser lido — tenta o próximo candidato
    }
  }
  return null;
}

let lastLoggedReadError = null; // evita spam do mesmo erro a cada poll (10s)

/**
 * Lê o qconsole.log e retorna o endereço da ÚLTIMA linha "Connecting to
 * IP:PORTA" encontrada — ou seja, o servidor mais recente que o jogo
 * tentou/conseguiu conectar.
 */
function readLatestConnectTarget(logPath) {
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
    lastLoggedReadError = null; // conseguiu ler — reseta pra logar de novo se voltar a falhar
  } catch (err) {
    // Loga só quando o erro muda, pra não spammar o console a cada 10s.
    // Códigos comuns: ENOENT (arquivo não existe ainda / -condebug não
    // configurado) ou EBUSY/EPERM (o próprio hl.exe está com o arquivo
    // aberto sem permitir leitura compartilhada, comum em engines antigas).
    if (lastLoggedReadError !== err.code) {
      lastLoggedReadError = err.code;
      console.warn(`[ServerWatcher] Não consegui ler o log (${err.code || err.message}):`, logPath);
    }
    return null;
  }

  CONNECT_LINE_REGEX.lastIndex = 0;
  let match;
  let last = null;
  while ((match = CONNECT_LINE_REGEX.exec(content)) !== null) {
    last = { ip: match[1], port: Number(match[2]) };
  }
  return last;
}

/**
 * Consulta A2S_INFO. Tenta o formato MODERNO primeiro (estilo Source, que
 * o HLDS atualizado do CS 1.6 entende), e se o servidor não responder
 * nesse formato, tenta de novo com o formato LEGADO do GoldSrc original
 * ("details") — comum em servidores com build antigo/muito customizado
 * (típico em servidores de mod tipo Zombie Plague que nunca atualizam o
 * engine). O parser aceita a resposta em qualquer um dos dois formatos.
 * Referência: https://developer.valvesoftware.com/wiki/Server_queries
 */
async function queryServerInfo(ip, port) {
  const modernRequest = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from('TSource Engine Query\0', 'ascii'),
  ]);
  const legacyRequest = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from('details\0', 'ascii'),
  ]);

  const modernResult = await sendQuery(ip, port, modernRequest);
  if (modernResult) return modernResult;

  return sendQuery(ip, port, legacyRequest);
}

/**
 * Consulta A2S_PLAYER (lista de jogadores conectados agora no servidor).
 * O protocolo exige um handshake de anti-spoof: manda o pedido com um
 * challenge "vazio" (0xFFFFFFFF) e, se o servidor responder com um
 * challenge de verdade (header 'A'), reenvia o mesmo pedido com esse
 * valor. Servidores GoldSrc mais antigos podem responder direto com a
 * lista (header 'D'), sem exigir esse round-trip extra — o código aceita
 * os dois casos.
 * Referência: https://developer.valvesoftware.com/wiki/Server_queries#Player
 *
 * @returns {Promise<string[]|null>} nomes dos jogadores conectados, ou
 *   null se a consulta falhar/der timeout (inconclusivo — não confundir
 *   com "zero jogadores", que é um array vazio).
 */
async function queryPlayerList(ip, port) {
  const buildRequest = (challenge) => Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]),
    challenge,
  ]);

  const emptyChallenge = Buffer.from([0xff, 0xff, 0xff, 0xff]);
  const firstResponse = await sendRawQuery(ip, port, buildRequest(emptyChallenge));
  if (!firstResponse) return null;

  if (firstResponse[4] === 0x44) { // 'D' — já veio a lista direto
    return parseA2sPlayers(firstResponse);
  }

  if (firstResponse[4] === 0x41) { // 'A' — challenge real, reenvia com ele
    const realChallenge = firstResponse.subarray(5, 9);
    const secondResponse = await sendRawQuery(ip, port, buildRequest(realChallenge));
    if (secondResponse && secondResponse[4] === 0x44) {
      return parseA2sPlayers(secondResponse);
    }
  }

  return null;
}

function parseA2sPlayers(buf) {
  if (buf.length < 6 || buf.readInt32LE(0) !== -1 || buf[4] !== 0x44) return null;

  let offset = 6; // 4 (header) + 1 ('D') + 1 (contagem de jogadores)
  const names = [];
  while (offset < buf.length) {
    offset += 1; // índice do jogador (1 byte, não usado)
    if (offset >= buf.length) break;
    const nameRes = readCString(buf, offset);
    names.push(nameRes.str);
    offset = nameRes.next;
    offset += 4; // score (int32)
    offset += 4; // duration (float32)
  }
  return names;
}

/**
 * Igual ao sendQuery, mas devolve o buffer cru (sem passar pelo parser
 * de A2S_INFO) — usado pelo A2S_PLAYER, que tem seu próprio parser.
 */
function sendRawQuery(ip, port, request) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');

    const timeout = setTimeout(() => {
      socket.close();
      resolve(null);
    }, QUERY_TIMEOUT_MS);

    socket.once('error', () => {
      clearTimeout(timeout);
      try { socket.close(); } catch (_) {}
      resolve(null);
    });

    socket.once('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      resolve(msg);
    });

    socket.send(request, port, ip, (err) => {
      if (err) {
        clearTimeout(timeout);
        try { socket.close(); } catch (_) {}
        resolve(null);
      }
    });
  });
}

function sendQuery(ip, port, request) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');

    const timeout = setTimeout(() => {
      socket.close();
      resolve(null);
    }, QUERY_TIMEOUT_MS);

    socket.once('error', () => {
      clearTimeout(timeout);
      try { socket.close(); } catch (_) {}
      resolve(null);
    });

    socket.once('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      try {
        resolve(parseA2sResponse(msg));
      } catch (err) {
        resolve(null);
      }
    });

    socket.send(request, port, ip, (err) => {
      if (err) {
        clearTimeout(timeout);
        try { socket.close(); } catch (_) {}
        resolve(null);
      }
    });
  });
}

function readCString(buf, offset) {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 ? buf.length : end;
  return { str: buf.toString('utf8', offset, stop), next: stop + 1 };
}

/**
 * Aceita tanto a resposta moderna (header 'I' / 0x49) quanto a legada do
 * GoldSrc original (header 'm' / 0x6D) e normaliza pro mesmo formato de
 * saída, já que o resto do código (discord-rpc.js) não precisa saber
 * qual dos dois foi usado.
 */
function parseA2sResponse(buf) {
  if (buf.length < 6 || buf.readInt32LE(0) !== -1) return null;

  if (buf[4] === 0x49) return parseModernInfo(buf);
  if (buf[4] === 0x6d) return parseLegacyInfo(buf);
  return null;
}

function parseModernInfo(buf) {
  let offset = 6; // 4 (header) + 1 ('I') + 1 (protocol version, ignorado)
  const name = readCString(buf, offset); offset = name.next;
  const map = readCString(buf, offset); offset = map.next;
  const folder = readCString(buf, offset); offset = folder.next;
  const game = readCString(buf, offset); offset = game.next;

  if (offset + 2 > buf.length) return null;

  offset += 2; // game ID (short), não usado
  const players = buf.readUInt8(offset); offset += 1;
  const maxPlayers = buf.readUInt8(offset); offset += 1;

  return { name: name.str, map: map.str, game: game.str, players, maxPlayers };
}

/**
 * Formato legado (S2A_INFO_DETAILED, header 'm'): endereço, nome, mapa,
 * pasta do mod, descrição, jogadores, máximo de jogadores, versão do
 * protocolo, tipo de servidor, ambiente, visibilidade... (o resto dos
 * campos depois de "max players" não importa pra gente).
 */
function parseLegacyInfo(buf) {
  let offset = 5; // 4 (header) + 1 ('m')
  const address = readCString(buf, offset); offset = address.next;
  const name = readCString(buf, offset); offset = name.next;
  const map = readCString(buf, offset); offset = map.next;
  const folder = readCString(buf, offset); offset = folder.next;
  const game = readCString(buf, offset); offset = game.next;

  if (offset + 2 > buf.length) return null;

  const players = buf.readUInt8(offset); offset += 1;
  const maxPlayers = buf.readUInt8(offset); offset += 1;

  return { name: name.str, map: map.str, game: game.str, players, maxPlayers };
}

async function poll(callbacks) {
  // 1) Vê se apareceu uma conexão nova/diferente no log desde a última checagem
  const logPath = resolveLogPath(watchedInstallPath);
  const seen = readLatestConnectTarget(logPath);
  if (seen) {
    const seenKey = `${seen.ip}:${seen.port}`;
    const currentKey = currentTarget ? `${currentTarget.ip}:${currentTarget.port}` : null;
    if (seenKey !== currentKey) {
      console.log(`[ServerWatcher] Conexão detectada no log: ${seenKey}`);
      currentTarget = seen;
      failureCount = 0;
    }
  }

  // 2) Sem nenhum servidor conhecido ainda (log não existe, ou nunca conectou)
  if (!currentTarget) {
    if (lastServerKey !== null) {
      lastServerKey = null;
      callbacks.onNoServer();
    }
    return;
  }

  // 3) Consulta os dados reais do servidor atual
  const key = `${currentTarget.ip}:${currentTarget.port}`;
  const info = await queryServerInfo(currentTarget.ip, currentTarget.port);

  if (!info) {
    failureCount += 1;
    if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`[ServerWatcher] ${key} parou de responder — considerando desconectado.`);
      currentTarget = null;
      failureCount = 0;
      if (lastServerKey !== null) {
        lastServerKey = null;
        callbacks.onNoServer();
      }
    }
    return;
  }

  failureCount = 0;

  // 4) O servidor respondeu, mas isso não garante que VOCÊ ainda está
  // nele — outros jogadores mantêm o A2S_INFO respondendo mesmo depois
  // que você saiu. Se soubermos o nome configurado do jogador local,
  // confere se ele ainda aparece na lista de jogadores conectados agora.
  if (localPlayerName) {
    const players = await queryPlayerList(currentTarget.ip, currentTarget.port);
    if (players !== null) { // null = consulta falhou/timeout, inconclusivo — ignora
      const stillIn = players.some(n => n.trim().toLowerCase() === localPlayerName.toLowerCase());
      if (!stillIn) {
        console.log(`[ServerWatcher] ${key} responde, mas "${localPlayerName}" não está mais na lista de jogadores — desconectado.`);
        currentTarget = null;
        failureCount = 0;
        if (lastServerKey !== null) {
          lastServerKey = null;
          callbacks.onNoServer();
        }
        return;
      }
    }
  }

  if (lastServerKey !== key) {
    console.log(`[ServerWatcher] Servidor: "${info.name}" (${info.map}) — ${key}`);
  }
  lastServerKey = key;
  callbacks.onServerInfo({ ip: currentTarget.ip, port: currentTarget.port, ...info });
}

/**
 * @param {string} installPath Pasta onde está o executável do jogo (ex.:
 *   ".../Counter-Strike 1.6"). O log fica em "<installPath>/cstrike/qconsole.log".
 * @param {{ onServerInfo: (info: object) => void, onNoServer: () => void }} callbacks
 */
function start(installPath, callbacks) {
  stop();

  if (!installPath) {
    console.warn('[ServerWatcher] installPath não disponível — não é possível localizar o qconsole.log.');
    return;
  }

  watchedInstallPath = installPath;
  currentTarget = null;
  failureCount = 0;
  lastServerKey = null;
  lastLoggedReadError = null;
  localPlayerName = getLocalPlayerName(installPath);
  console.log('[ServerWatcher] Observando log de console, caminhos possíveis:', getLogPathCandidates(installPath).join(' | '));
  if (localPlayerName) {
    console.log(`[ServerWatcher] Nome do jogador local: "${localPlayerName}" — checagem de desconexão via A2S_PLAYER ativada.`);
  } else {
    console.log('[ServerWatcher] Nome do jogador local não encontrado em userconfig.cfg/config.cfg — checagem de desconexão via A2S_PLAYER desativada, usando só A2S_INFO.');
  }

  poll(callbacks); // checagem imediata, não espera o primeiro intervalo
  pollHandle = setInterval(() => poll(callbacks), POLL_INTERVAL_MS);
}

function stop() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  watchedInstallPath = null;
  currentTarget = null;
  failureCount = 0;
  lastServerKey = null;
  lastLoggedReadError = null;
  localPlayerName = null;
}

module.exports = { start, stop };