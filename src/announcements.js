// ===== Announcements + Hero =====

// Carrega os anúncios e a configuração da Hero via IPC
// (main process → GitHub ou fallback local).
// Ao abrir o launcher e depois a cada 2 minutos.

(function () {

  const GRID       = document.getElementById('news-grid');        // INÍCIO
  const GRID_FULL  = document.getElementById('news-grid-full');   // NOTÍCIAS
  const HERO       = document.querySelector('.hero');             // HERO

  const MAIN_LIMIT = 3;
  const INTERVAL_MS = 2 * 60 * 1000; // 2 minutos

  if (!GRID && !GRID_FULL && !HERO) return;


  // ============================================================
  // ANÚNCIOS
  // ============================================================

  const TYPE_META = {

    news: {
      label: '📰 NOTÍCIA',
      color: '#ff7a1a'
    },

    update: {
      label: '🔄 ATUALIZAÇÃO',
      color: '#3ddc84'
    },

    event: {
      label: '📅 EVENTO',
      color: '#e8b923'
    },

    promo: {
      label: '🎁 PROMOÇÃO',
      color: '#a060ff'
    },

  };


  // ── Formatação de data ──────────────────────────────────────

  function formatDate(str) {

    if (!str) return '';

    try {

      const [y, m, d] = str.split('-').map(Number);

      return new Date(y, m - 1, d)
        .toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
        .toUpperCase();

    } catch {

      return str;

    }

  }


  // ── Abre link via IPC ou navegador ───────────────────────────

  function openLink(url) {

    if (!url) return;

    if (
      window.api &&
      typeof window.api.openAnnouncementLink === 'function'
    ) {

      window.api.openAnnouncementLink(url);

    } else {

      window.open(url, '_blank', 'noopener');

    }

  }


  // ── Cria card de anúncio ────────────────────────────────────

  function createCard(ann) {

    const meta = TYPE_META[ann.type] || TYPE_META.news;

    const hasImg =
      ann.image &&
      ann.image.trim() !== '';

    const hasLink =
      ann.link &&
      ann.link.trim() !== '';

    const article = document.createElement('article');

    article.className = 'news-card ann-card';


    // Thumbnail

    const thumb = document.createElement('div');

    thumb.className = 'news-thumb ann-thumb';


    if (hasImg) {

      thumb.classList.add('ann-has-img');

      const img = document.createElement('img');

      img.src = ann.image;
      img.alt = ann.title;
      img.className = 'ann-img';

      img.onerror = () => {

        thumb.classList.remove('ann-has-img');

      };

      thumb.appendChild(img);

    }


    article.appendChild(thumb);


    // Corpo

    const body = document.createElement('div');

    body.className = 'news-body ann-body';


    // Badge + data

    const metaLine = document.createElement('div');

    metaLine.className = 'ann-meta-line';


    const badge = document.createElement('span');

    badge.className =
      `ann-badge ann-badge--${ann.type || 'news'}`;

    badge.textContent = meta.label;


    const dateEl = document.createElement('span');

    dateEl.className = 'news-date';

    dateEl.textContent = formatDate(ann.date);


    metaLine.appendChild(badge);
    metaLine.appendChild(dateEl);

    body.appendChild(metaLine);


    // Título

    const h3 = document.createElement('h3');

    h3.textContent = ann.title;

    body.appendChild(h3);


    // Descrição

    if (ann.description) {

      const p = document.createElement('p');

      p.textContent = ann.description;

      body.appendChild(p);

    }


    // Link

    if (hasLink) {

      const btn = document.createElement('button');

      btn.className = 'ann-link-btn';

      btn.title = 'Saiba mais';

      btn.innerHTML = `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      `;


      btn.addEventListener('click', (e) => {

        e.stopPropagation();

        openLink(ann.link);

      });


      body.appendChild(btn);


      // Clique no card inteiro

      article.style.cursor = 'pointer';

      article.addEventListener('click', () => {

        openLink(ann.link);

      });

    }


    article.appendChild(body);

    return article;

  }


  // ── Renderiza anúncios ──────────────────────────────────────

  const lastSignatures = {
    main: '',
    full: ''
  };


  function computeSignature(list) {

    return list
      .map(a => [
        a.id,
        a.type,
        a.title,
        a.description,
        a.image,
        a.link,
        a.date,
        a.priority
      ].join('|'))
      .join(',');

  }


  function renderInto(grid, list, key) {

    if (!grid) return;

    const signature = computeSignature(list);

    if (signature === lastSignatures[key]) return;

    lastSignatures[key] = signature;


    if (list.length === 0) return;

    grid.innerHTML = '';

    list.forEach(ann => {

      grid.appendChild(createCard(ann));

    });

  }


  // ── Ordenação ───────────────────────────────────────────────

  function sortByPriorityThenDate(list) {

    return [...list].sort((a, b) => {

      const pa = a.priority || 0;
      const pb = b.priority || 0;

      if (pb !== pa) {

        return pb - pa;

      }


      const da = a.date
        ? new Date(a.date).getTime()
        : 0;

      const db = b.date
        ? new Date(b.date).getTime()
        : 0;

      return db - da;

    });

  }


  function render(announcements) {

    const active = sortByPriorityThenDate(
      (announcements || [])
        .filter(a => a.status === 'active')
    );


    // Página inicial

    renderInto(
      GRID,
      active.slice(0, MAIN_LIMIT),
      'main'
    );


    // Página de notícias

    renderInto(
      GRID_FULL,
      active,
      'full'
    );

  }


  // ============================================================
  // HERO
  // ============================================================

  let heroTimer = null;

  let heroSignature = '';


  function renderHero(heroConfig) {

    // Não existe Hero nessa página

    if (!HERO) return;


    // Não existe configuração

    if (!heroConfig) {

      console.warn(
        '[Hero] Configuração da Hero não encontrada.'
      );

      return;

    }


    // Hero desativada

    if (heroConfig.enabled === false) {

      if (heroTimer) {

        clearInterval(heroTimer);

        heroTimer = null;

      }

      HERO.style.backgroundImage = '';

      return;

    }


    // Garante que images seja um array

    const images = Array.isArray(heroConfig.images)
      ? heroConfig.images
          .filter(url =>
            typeof url === 'string' &&
            url.trim() !== ''
          )
      : [];


    if (images.length === 0) {

      console.warn(
        '[Hero] Nenhuma imagem configurada.'
      );

      return;

    }


    // Cria uma assinatura para saber se a configuração mudou

    const signature = JSON.stringify({

      images,
      interval: heroConfig.interval || 7500

    });


    // Se não mudou, não reinicia a animação

    if (signature === heroSignature) {

      return;

    }


    heroSignature = signature;


    // Se já existia uma animação, remove

    if (heroTimer) {

      clearInterval(heroTimer);

      heroTimer = null;

    }


    let current = 0;


    // Primeira imagem

    HERO.style.backgroundImage =
      `url("${images[current]}")`;


    // Se só existe uma imagem, não precisa de intervalo

    if (images.length <= 1) {

      return;

    }


    // Intervalo definido pelo painel

    const interval =
      Number(heroConfig.interval) || 7500;


    heroTimer = setInterval(() => {

      current++;

      if (current >= images.length) {

        current = 0;

      }


      HERO.style.backgroundImage =
        `url("${images[current]}")`;

    }, interval);

  }


  // ============================================================
  // CARREGAMENTO
  // ============================================================

  async function load() {

    try {

      let data;


      // ========================================================
      // CAMINHO PRINCIPAL
      // Electron → main process → GitHub
      // ========================================================

      if (
        window.api &&
        typeof window.api.getAnnouncements === 'function'
      ) {

        data = await window.api.getAnnouncements();

      }


      // ========================================================
      // FALLBACK
      // Navegador / desenvolvimento
      // ========================================================

      else {

        const res =
          await fetch('./announcements.json');


        if (!res.ok) {

          throw new Error(
            `HTTP ${res.status}`
          );

        }


        data = await res.json();

      }


      // ========================================================
      // ANÚNCIOS
      // ========================================================

      render(data?.announcements);


      // ========================================================
      // HERO
      // ========================================================

      renderHero(data?.hero);


    } catch (err) {

      console.warn(
        '[Announcements/Hero] Falha ao carregar:',
        err.message || err
      );

    }

  }


  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  // Carrega imediatamente

  load();


  // Atualiza anúncios + Hero a cada 2 minutos

  setInterval(
    load,
    INTERVAL_MS
  );

})();