// ===== Anúncios / Notícias carregados do GitHub =====
// O Dashboard (painel de admin) salva um announcements.json nesse
// repositório. Aqui a gente busca esse JSON e troca os 3 cards estáticos
// da home pelos anúncios reais marcados como "ativos".
//
// Se o fetch falhar por qualquer motivo (sem internet, repo/path errado,
// JSON malformado), os cards estáticos que já estão no HTML continuam
// visíveis — não tem tela quebrada, só não atualiza.

const ANNOUNCEMENTS_CONFIG = {
  owner: 'guilhermeteixeira01',
  repo: 'NeuraCSlauncher',
  branch: 'main',
  // Ajuste aqui se o "path" configurado no Dashboard for diferente.
  path: 'src/announcements.json',
};

// raw.githubusercontent.com não tem o delay de propagação do jsDelivr
// (que cacheia por bastante tempo) — preferimos ele pra anúncio aparecer
// rápido depois de salvo no Dashboard. jsDelivr fica só como plano B.
function buildAnnouncementsUrls() {
  const { owner, repo, branch, path } = ANNOUNCEMENTS_CONFIG;
  return [
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?t=${Date.now()}`,
    `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`,
  ];
}

async function fetchAnnouncementsJson() {
  const urls = buildAnnouncementsUrls();
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn('[Announcements] Falhou em', url, err.message);
    }
  }
  throw lastErr || new Error('Nenhuma URL de anúncios respondeu.');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MESES_PT = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return `${String(d.getDate()).padStart(2, '0')} ${MESES_PT[d.getMonth()]} ${d.getFullYear()}`;
}

// Reaproveita as classes de cor (thumb-map / thumb-season / thumb-weapon)
// que já existem no style.css pros cards estáticos, só pra dar uma
// variação visual de acordo com o tipo do anúncio.
const THUMB_BY_TYPE = {
  news: 'thumb-map',
  update: 'thumb-season',
  event: 'thumb-weapon',
};

// Mesmas cores do badge "tipo" do Dashboard (.ann-type) — mas em vez de
// emoji (que fica com peso/alinhamento inconsistente entre Windows/Mac),
// usa o mesmo padrão visual de "bolinha colorida + texto" que o próprio
// style.css já usa em .status-dot (lista de amigos), pra ficar nativo
// do app em vez de algo "colado por fora".
const TYPE_BADGE = {
  news:   { label: 'NOTÍCIA',     color: '#ff7a1a' },
  update: { label: 'ATUALIZAÇÃO', color: '#3ddc84' },
  event:  { label: 'EVENTO',      color: '#e8b923' },
  promo:  { label: 'PROMOÇÃO',    color: '#b080ff' },
};

function renderTypeBadge(type) {
  const t = TYPE_BADGE[type] || TYPE_BADGE.news;
  return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.6px;color:${t.color};text-transform:uppercase;line-height:1">
    <span style="width:6px;height:6px;border-radius:50%;background:${t.color};box-shadow:0 0 6px ${t.color}80;flex-shrink:0"></span>${t.label}
  </span>`;
}

function renderCard(a) {
  const thumbClass = THUMB_BY_TYPE[a.type] || 'thumb-map';
  // Se vier uma imagem, usa ela. Se a URL falhar ao carregar (link quebrado,
  // imagem removida, etc), o onerror troca pra cor sólida sem deixar buraco.
  const thumbHtml = a.image
    ? `<img src="${escapeHtml(a.image)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'news-thumb ${thumbClass}' }))"/>`
    : '';

  return `
    <article class="news-card">
      <div class="news-thumb ${a.image ? '' : thumbClass}">${thumbHtml}</div>
      <div class="news-body">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          ${renderTypeBadge(a.type)}
          <span class="news-date" style="margin:0">${escapeHtml(formatDate(a.date))}</span>
        </div>
        <h3 style="margin:0 0 4px">${escapeHtml(a.title)}</h3>
        <p>${escapeHtml(a.description)}</p>
      </div>
    </article>`;
}

async function loadAnnouncements() {
  const grid = document.getElementById('news-grid');
  if (!grid) return;

  try {
    const data = await fetchAnnouncementsJson();
    const items = (data.announcements || [])
      .filter((a) => a.status === 'active')
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 3);

    if (items.length === 0) {
      console.log('[Announcements] JSON carregado, mas sem anúncios ativos — mantendo cards padrão.');
      return;
    }

    grid.innerHTML = items.map(renderCard).join('');
    console.log(`[Announcements] ${items.length} anúncio(s) carregado(s) do GitHub.`);
  } catch (err) {
    console.error('[Announcements] Não foi possível carregar os anúncios, mantendo cards padrão:', err);
  }
}

loadAnnouncements();

// Recarrega sozinho a cada 5 minutos, sem precisar reabrir o launcher —
// garante que um anúncio novo apareça pro cliente mesmo que ele deixe o
// launcher aberto em segundo plano por um tempão.
const ANNOUNCEMENTS_REFRESH_MS = 5 * 60 * 1000;
setInterval(loadAnnouncements, ANNOUNCEMENTS_REFRESH_MS);