// ===== Announcements =====
// Carrega os anúncios via IPC (main process → GitHub ou fallback local)
// assim que o launcher abre, e repete a cada 2 minutos automaticamente.

(function () {
  const GRID        = document.getElementById('news-grid');
  const INTERVAL_MS = 2 * 10 * 1000; // 2 minutos

  if (!GRID) return;

  // Mapa de cores/label por tipo
  const TYPE_META = {
    news:   { label: '📰 NOTÍCIA',     color: '#ff7a1a' },
    update: { label: '🔄 ATUALIZAÇÃO', color: '#3ddc84' },
    event:  { label: '📅 EVENTO',      color: '#e8b923' },
    promo:  { label: '🎁 PROMOÇÃO',    color: '#a060ff' },
  };

  // ── Formatação de data ──────────────────────────────────────────────────
  function formatDate(str) {
    if (!str) return '';
    try {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d)
        .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
        .toUpperCase();
    } catch { return str; }
  }

  // ── Abre link via IPC (Electron) ou window.open (dev/browser) ──────────
  function openLink(url) {
    if (!url) return;
    if (window.api && typeof window.api.openAnnouncementLink === 'function') {
      window.api.openAnnouncementLink(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  // ── Cria um card de anúncio ─────────────────────────────────────────────
  function createCard(ann) {
    const meta   = TYPE_META[ann.type] || TYPE_META.news;
    const hasImg  = ann.image && ann.image.trim() !== '';
    const hasLink = ann.link  && ann.link.trim()  !== '';

    const article = document.createElement('article');
    article.className = 'news-card ann-card';

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'news-thumb ann-thumb';
    if (hasImg) {
      thumb.classList.add('ann-has-img');
      const img = document.createElement('img');
      img.src       = ann.image;
      img.alt       = ann.title;
      img.className = 'ann-img';
      img.onerror   = () => {
        // se a imagem quebrar, colapsa o thumb
        thumb.classList.remove('ann-has-img');
      };
      thumb.appendChild(img);
    }
    article.appendChild(thumb);

    // Corpo
    const body = document.createElement('div');
    body.className = 'news-body ann-body';

    // Badge de tipo + data
    const metaLine = document.createElement('div');
    metaLine.className = 'ann-meta-line';

    const badge = document.createElement('span');
    badge.className = `ann-badge ann-badge--${ann.type || 'news'}`;
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

    if (hasLink) {
      const btn = document.createElement('button');
      btn.className = 'ann-link-btn';
      btn.title = 'Saiba mais';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.3"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLink(ann.link);
      });
      body.appendChild(btn);

      // Clique no card inteiro também abre o link
      article.style.cursor = 'pointer';
      article.addEventListener('click', () => openLink(ann.link));
    }

    article.appendChild(body);
    return article;
  }

  // ── Renderiza a lista de anúncios no grid ───────────────────────────────
  let lastRenderedIds = ''; // evita re-render desnecessário se nada mudou

  function render(announcements) {
    const active = (announcements || []).filter(a => a.status === 'active');

    // Assinatura inclui o conteúdo todo (não só os ids), pra detectar
    // edições em anúncios que já existiam (ex: trocou o título/imagem
    // mas o id continua o mesmo) e ainda assim disparar o re-render.
    const signature = active
      .map(a => [a.id, a.type, a.title, a.description, a.image, a.link, a.date].join('|'))
      .join(',');
    if (signature === lastRenderedIds) return; // nada mudou de verdade, não pisca
    lastRenderedIds = signature;

    if (active.length === 0) return; // mantém os cards estáticos como fallback

    GRID.innerHTML = '';
    active.forEach(ann => GRID.appendChild(createCard(ann)));
  }

  // ── Busca os anúncios ───────────────────────────────────────────────────
  async function load() {
    try {
      let data;

      if (window.api && typeof window.api.getAnnouncements === 'function') {
        // Caminho principal: via IPC → main process → GitHub ou arquivo local
        data = await window.api.getAnnouncements();
      } else {
        // Fallback para dev no navegador
        const res = await fetch('./announcements.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }

      render(data?.announcements);
    } catch (err) {
      console.warn('[Announcements] Falha ao carregar:', err.message || err);
    }
  }

  // ── Inicializa ──────────────────────────────────────────────────────────
  // Carregamento imediato ao abrir o launcher
  load();

  // Refresh automático a cada 2 minutos
  setInterval(load, INTERVAL_MS);
})();