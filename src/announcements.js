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

function renderCard(a) {
  const thumbClass = THUMB_BY_TYPE[a.type] || 'thumb-map';
  return `
    <article class="news-card">
      <div class="news-thumb ${thumbClass}"></div>
      <div class="news-body">
        <span class="news-date">${escapeHtml(formatDate(a.date))}</span>
        <h3>${escapeHtml(a.title)}</h3>
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