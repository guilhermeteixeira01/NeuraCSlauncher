// ===== Sistema de Internacionalização (i18n) =====
// Dicionário de traduções (pt/en/es) + funções para aplicar e trocar o
// idioma da interface. Carregar ANTES de renderer.js, pois o renderer usa
// window.i18n.t(...) para montar os textos dinâmicos (status do botão
// JOGAR, opção de execução detectada, barra de atualização, etc).
//
// Uso:
//   window.i18n.t('chave')                  -> string traduzida
//   window.i18n.t('chave', { versao: '1.2' }) -> com interpolação {versao}
//   window.i18n.setLanguage('en')            -> troca o idioma e reaplica tudo
//   window.i18n.getLanguage()                -> idioma atual ('pt' | 'en' | 'es')
//
// Elementos estáticos no HTML se traduzem sozinhos via atributos:
//   data-i18n="chave"        -> substitui o innerHTML do elemento
//   data-i18n-title="chave"  -> substitui o atributo title do elemento
//
// Elementos com texto dinâmico (setados via JS em renderer.js) usam
// window.i18n.t('chave') diretamente na hora de montar a string, e o
// renderer escuta o evento 'i18n:changed' pra re-renderizar quando o
// idioma muda no meio do uso.

(function () {
  const STORAGE_KEY = 'neuracs-lang';
  const DEFAULT_LANG = 'pt';

  const dict = {
    pt: {
      'title.idioma': 'Idioma',
      'title.minimizar': 'Minimizar',
      'title.maximizar': 'Maximizar',
      'title.fechar': 'Fechar',

      'nav.inicio': 'INÍCIO',
      'nav.atualizacoes': 'ATUALIZAÇÕES',
      'nav.noticias': 'NOTÍCIAS',
      'nav.servidores': 'SERVIDORES',
      'nav.loja': 'LOJA',

      'hero.subtitle': 'TÁTICA RENOVADA.<br/>UMA NOVA ERA DE COMBATE.',

      'play.checking': 'VERIFICANDO STEAM...',
      'play.play': 'JOGAR',
      'play.notfound': 'JOGO NÃO ENCONTRADO',
      'play.playing': 'JOGANDO',

      'launch.checking': 'VERIFICANDO INSTALAÇÃO...',
      'launch.steam': 'STEAM — COUNTER-STRIKE 1.6 DETECTADO',
      'launch.manual': 'EXECUTÁVEL CONFIGURADO MANUALMENTE',
      'launch.autoscan': 'NOSTEAM - COUNTER-STRIKE 1.6 DETECTADO',
      'launch.running': 'JOGO EM EXECUÇÃO',
      'launch.changepath': 'Escolher outro executável...',

      'nogame.hint': 'Nenhuma instalação encontrada.',
      'nogame.browse': 'Selecionar executável...',
      'nogame.steam': 'Baixar na Steam ↗',
      'nogame.secondary': 'Baixar Versão Gratis ↗',

      'news.latest': 'ÚLTIMAS NOTÍCIAS',
      'news.viewall': 'VER TODAS →',
      'updates.title': 'ATUALIZAÇÕES',
      'news.title': 'NOTÍCIAS',
      'servers.title': 'SERVIDORES',
      'store.title': 'LOJA',

      'news1.date': '24 MAI 2024',
      'news1.title': 'Atualização de Mapas',
      'news1.desc': 'Mudanças importantes foram feitas em dois mapas competitivos.',
      'news2.date': '17 MAI 2024',
      'news2.title': 'Chegou a Temporada 7!',
      'news2.desc': 'Novas recompensas, medalhas e muito mais.',
      'news3.date': '10 MAI 2024',
      'news3.title': 'Workshop em Destaque',
      'news3.desc': 'Confira os mapas e skins selecionadas pela comunidade.',

      'quick.competitivo.title': 'COMPETITIVO',
      'quick.competitivo.desc': 'Entre para uma partida ranqueada.',
      'quick.deathmatch.title': 'DEATHMATCH',
      'quick.deathmatch.desc': 'Aqueça sua mira em servidores DM.',
      'quick.servidores.title': 'SERVIDORES',
      'quick.servidores.desc': 'Navegue e conecte-se a servidores.',
      'quick.config.title': 'CONFIGURAÇÕES',
      'quick.config.desc': 'Ajuste as opções do seu jogo.',

      'profile.level': 'Nível 99',
      'friends.online': 'AMIGOS ONLINE',
      'friends.viewall': 'VER TODOS AMIGOS →',
      'friend.status1': 'Competitivo - Mirage',
      'friend.status2': 'Competitivo - Inferno',
      'friend.status3': 'No Menu',
      'friend.status4': 'Jogando Deathmatch',
      'friend.status5': 'Competitivo - Dust II',
      'friend.status6': 'Ausente',

      'store.comingsoon': 'EM BREVE',

      'update.checking': 'Verificando atualizações...',
      'update.available': 'Nova versão {versao} encontrada, baixando...',
      'update.downloading': 'Baixando atualização... {percent}%',
      'update.downloaded': 'Atualização {versao} baixada e pronta para instalar.',
      'update.error': 'Não foi possível verificar atualizações.',
      'update.install': 'REINICIAR E ATUALIZAR',

      'launching.starting': 'Iniciando o jogo...',
      'launching.started': 'Jogo iniciado!',

      'copyright.by': 'Por',
      'login.username': 'USUÁRIO',
      'login.password': 'SENHA',
      'login.forgotpassword': 'Esqueci minha senha',
      'login.submit': 'ENTRAR NA CONTA',
      'login.or': 'OU',
      'login.register': 'CRIAR NOVA CONTA',
    },

    en: {
      'title.idioma': 'Language',
      'title.minimizar': 'Minimize',
      'title.maximizar': 'Maximize',
      'title.fechar': 'Close',

      'nav.inicio': 'HOME',
      'nav.atualizacoes': 'UPDATES',
      'nav.noticias': 'NEWS',
      'nav.servidores': 'SERVERS',
      'nav.loja': 'STORE',

      'hero.subtitle': 'RENEWED TACTICS.<br/>A NEW ERA OF COMBAT.',

      'play.checking': 'CHECKING STEAM...',
      'play.play': 'PLAY',
      'play.notfound': 'GAME NOT FOUND',
      'play.playing': 'PLAYING',

      'launch.checking': 'CHECKING INSTALLATION...',
      'launch.steam': 'STEAM — COUNTER-STRIKE 1.6 DETECTED',
      'launch.manual': 'MANUALLY CONFIGURED EXECUTABLE',
      'launch.autoscan': 'NON-STEAM - COUNTER-STRIKE 1.6 DETECTED',
      'launch.running': 'GAME RUNNING',
      'launch.changepath': 'Choose another executable...',

      'nogame.hint': 'No installation found.',
      'nogame.browse': 'Select executable...',
      'nogame.steam': 'Download on Steam ↗',
      'nogame.secondary': 'Download Free Version ↗',

      'news.latest': 'LATEST NEWS',
      'news.viewall': 'VIEW ALL →',
      'updates.title': 'UPDATES',
      'news.title': 'NEWS',
      'servers.title': 'SERVERS',
      'store.title': 'STORE',

      'news1.date': 'MAY 24 2024',
      'news1.title': 'Map Update',
      'news1.desc': 'Important changes were made to two competitive maps.',
      'news2.date': 'MAY 17 2024',
      'news2.title': 'Season 7 Has Arrived!',
      'news2.desc': 'New rewards, medals, and much more.',
      'news3.date': 'MAY 10 2024',
      'news3.title': 'Featured Workshop',
      'news3.desc': 'Check out the maps and skins selected by the community.',

      'quick.competitivo.title': 'COMPETITIVE',
      'quick.competitivo.desc': 'Join a ranked match.',
      'quick.deathmatch.title': 'DEATHMATCH',
      'quick.deathmatch.desc': 'Warm up your aim on DM servers.',
      'quick.servidores.title': 'SERVERS',
      'quick.servidores.desc': 'Browse and connect to servers.',
      'quick.config.title': 'SETTINGS',
      'quick.config.desc': 'Adjust your game options.',

      'profile.level': 'Level 99',
      'friends.online': 'FRIENDS ONLINE',
      'friends.viewall': 'VIEW ALL FRIENDS →',
      'friend.status1': 'Competitive - Mirage',
      'friend.status2': 'Competitive - Inferno',
      'friend.status3': 'In Menu',
      'friend.status4': 'Playing Deathmatch',
      'friend.status5': 'Competitive - Dust II',
      'friend.status6': 'Away',

      'store.comingsoon': 'COMING SOON',

      'update.checking': 'Checking for updates...',
      'update.available': 'New version {versao} found, downloading...',
      'update.downloading': 'Downloading update... {percent}%',
      'update.downloaded': 'Update {versao} downloaded and ready to install.',
      'update.error': 'Could not check for updates.',
      'update.install': 'RESTART AND UPDATE',

      'launching.starting': 'Starting the game...',
      'launching.started': 'Game started!',

      'copyright.by': 'By',
      'login.username': 'USERNAME',
      'login.password': 'PASSWORD',
      'login.forgotpassword': 'Forgot my password',
      'login.submit': 'LOGIN TO ACCOUNT',
      'login.or': 'OR',
      'login.register': 'CREATE NEW ACCOUNT',
    },

    es: {
      'title.idioma': 'Idioma',
      'title.minimizar': 'Minimizar',
      'title.maximizar': 'Maximizar',
      'title.fechar': 'Cerrar',

      'nav.inicio': 'INICIO',
      'nav.atualizacoes': 'ACTUALIZACIONES',
      'nav.noticias': 'NOTICIAS',
      'nav.servidores': 'SERVIDORES',
      'nav.loja': 'TIENDA',

      'hero.subtitle': 'TÁCTICA RENOVADA.<br/>UNA NUEVA ERA DE COMBATE.',

      'play.checking': 'VERIFICANDO STEAM...',
      'play.play': 'JUGAR',
      'play.notfound': 'JUEGO NO ENCONTRADO',
      'play.playing': 'JUGANDO',

      'launch.checking': 'VERIFICANDO INSTALACIÓN...',
      'launch.steam': 'STEAM — COUNTER-STRIKE 1.6 DETECTADO',
      'launch.manual': 'EJECUTABLE CONFIGURADO MANUALMENTE',
      'launch.autoscan': 'NOSTEAM - COUNTER-STRIKE 1.6 DETECTADO',
      'launch.running': 'JUEGO EN EJECUCIÓN',
      'launch.changepath': 'Elegir otro ejecutable...',

      'nogame.hint': 'No se encontró ninguna instalación.',
      'nogame.browse': 'Seleccionar ejecutable...',
      'nogame.steam': 'Descargar en Steam ↗',
      'nogame.secondary': 'Descargar Versión Gratis ↗',

      'news.latest': 'ÚLTIMAS NOTICIAS',
      'news.viewall': 'VER TODAS →',
      'updates.title': 'ACTUALIZACIONES',
      'news.title': 'NOTICIAS',
      'servers.title': 'SERVIDORES',
      'store.title': 'TIENDA',

      'news1.date': '24 MAY 2024',
      'news1.title': 'Actualización de Mapas',
      'news1.desc': 'Se hicieron cambios importantes en dos mapas competitivos.',
      'news2.date': '17 MAY 2024',
      'news2.title': '¡Llegó la Temporada 7!',
      'news2.desc': 'Nuevas recompensas, medallas y mucho más.',
      'news3.date': '10 MAY 2024',
      'news3.title': 'Workshop Destacado',
      'news3.desc': 'Mira los mapas y skins seleccionados por la comunidad.',

      'quick.competitivo.title': 'COMPETITIVO',
      'quick.competitivo.desc': 'Entra a una partida clasificatoria.',
      'quick.deathmatch.title': 'DEATHMATCH',
      'quick.deathmatch.desc': 'Calienta tu puntería en servidores DM.',
      'quick.servidores.title': 'SERVIDORES',
      'quick.servidores.desc': 'Explora y conéctate a servidores.',
      'quick.config.title': 'CONFIGURACIÓN',
      'quick.config.desc': 'Ajusta las opciones de tu juego.',

      'profile.level': 'Nivel 99',
      'friends.online': 'AMIGOS EN LÍNEA',
      'friends.viewall': 'VER TODOS LOS AMIGOS →',
      'friend.status1': 'Competitivo - Mirage',
      'friend.status2': 'Competitivo - Inferno',
      'friend.status3': 'En el Menú',
      'friend.status4': 'Jugando Deathmatch',
      'friend.status5': 'Competitivo - Dust II',
      'friend.status6': 'Ausente',

      'store.comingsoon': 'PRÓXIMAMENTE',

      'update.checking': 'Verificando actualizaciones...',
      'update.available': 'Nueva versión {versao} encontrada, descargando...',
      'update.downloading': 'Descargando actualización... {percent}%',
      'update.downloaded': 'Actualización {versao} descargada y lista para instalar.',
      'update.error': 'No se pudieron verificar las actualizaciones.',
      'update.install': 'REINICIAR Y ACTUALIZAR',

      'launching.starting': 'Iniciando el juego...',
      'launching.started': '¡Juego iniciado!',

      'copyright.by': 'Por',
      'login.username': 'USUARIO',
      'login.password': 'CONTRASEÑA',
      'login.forgotpassword': 'Olvidé mi contraseña',
      'login.submit': 'INICIAR SESIÓN',
      'login.or': 'O',
      'login.register': 'CREAR NUEVA CUENTA',
    },
  };

  const HTML_LANG = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

  function getLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return dict[saved] ? saved : DEFAULT_LANG;
  }

  function t(key, vars) {
    const lang = getLanguage();
    let str = (dict[lang] && dict[lang][key]) || dict[DEFAULT_LANG][key] || key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(`{${k}}`, vars[k]);
      });
    }
    return str;
  }

  function applyTranslations() {
    const lang = getLanguage();
    document.documentElement.lang = HTML_LANG[lang] || 'pt-BR';

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n'));
    });

    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    // Destaca no dropdown qual idioma está selecionado atualmente
    document.querySelectorAll('#language-menu [data-lang]').forEach((btn) => {
      btn.classList.toggle('lang-active', btn.dataset.lang === lang);
    });

    // Avisa o resto do app (renderer.js) pra re-renderizar textos dinâmicos
    // (label do botão JOGAR, opção de execução detectada, barra de update...)
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  }

  function setLanguage(lang) {
    if (!dict[lang]) return;
    localStorage.setItem(STORAGE_KEY, lang);
    applyTranslations();
  }

  window.i18n = { t, setLanguage, getLanguage, applyTranslations };

  document.addEventListener('DOMContentLoaded', applyTranslations);
})();
