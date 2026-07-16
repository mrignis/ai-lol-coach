const $ = id => document.getElementById(id);

let loadTimer = null;
let lastData = null; // kept so switching language re-renders the current result

async function loadRegions() {
  // Remember the player's last region so they don't keep re-picking it.
  const saved = localStorage.getItem('lolcoach_region') || 'euw1';
  try {
    const { platforms } = await (await fetch('/api/regions')).json();
    $('region').innerHTML = platforms.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
    $('region').value = saved;
  } catch {
    $('region').innerHTML = '<option value="euw1">EUW</option>';
  }
  $('region').addEventListener('change', () => {
    localStorage.setItem('lolcoach_region', $('region').value);
  });
}

function startLoading() {
  $('error').hidden = true;
  $('results').hidden = true;
  $('loading').hidden = false;
  $('go').disabled = true;
  const steps = t('loading');
  let i = 0;
  $('loadingText').textContent = steps[0];
  loadTimer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    $('loadingText').textContent = steps[i];
  }, 1600);
}

function stopLoading() {
  clearInterval(loadTimer);
  $('loading').hidden = true;
  $('go').disabled = false;
}

function showError(msg) {
  stopLoading();
  $('error').textContent = msg;
  $('error').hidden = false;
}

const pct = v => Math.round(v * 100) + '%';

function fmtMetric(key, v) {
  if (key === 'kp') return pct(v);
  if (key === 'deaths' || key === 'csPerMin') return v.toFixed(1);
  if (key === 'visPerMin') return v.toFixed(2);
  return String(Math.round(v));
}

function render(data) {
  lastData = data;
  const s = data.summary;

  // Summary card
  $('playerName').textContent = `${s.gameName} #${s.tagLine}`;
  const rank = s.rank ? `${cap(s.rank.tier)} ${s.rank.rank} · ${s.rank.lp} LP` : t('unranked');
  $('playerRank').textContent = `${rank} · ${t('mostly')} ${tRole(s.mainRole)}`;
  $('wrValue').textContent = pct(s.winRate);
  $('wrValue').style.color = s.winRate >= 0.5 ? 'var(--green)' : 'var(--red)';
  $('wrGames').textContent = s.gamesAnalyzed;
  $('mainChamps').innerHTML = s.mainChamps.map(c =>
    `<div class="champ"><b>${c.champion}</b><span class="cwr">${c.games}g · ${pct(c.wins / c.games)}</span></div>`
  ).join('');
  if (s.roleMixed) {
    $('roleNote').hidden = false;
    $('roleNote').textContent = t('roleMixed');
  } else {
    $('roleNote').hidden = true;
  }
  if (s.queueScope === 'any') {
    $('roleNote').hidden = false;
    $('roleNote').textContent = t('noRanked');
  }

  // Weakness chips
  $('chips').innerHTML = data.weaknesses.gaps.map(g => {
    const worse = g.gap > 0;
    return `<div class="chip"><span class="k">${tMetric(g.key)}:</span> ` +
      `<span class="v" style="color:${worse ? 'var(--red)' : 'var(--green)'}">${fmtMetric(g.key, g.player)}</span> ` +
      `<span class="t">→ ${t('target')} ${fmtMetric(g.key, g.target)}</span></div>`;
  }).join('');

  // Coaching text — localize the offline template; LLM output is already localized.
  const coachText = data.weaknesses.coachSource === 'template'
    ? templateCoach(data.weaknesses.gaps)
    : data.weaknesses.coachText;
  $('coachText').innerHTML = escapeHtml(coachText)
    .replace(/(\d+(?:\.\d+)?%?)/g, '<span class="num">$1</span>');
  $('coachSource').textContent = data.weaknesses.coachSource === 'template'
    ? t('coachLocal')
    : `${t('coachBy')} ${data.weaknesses.coachSource}`;

  // Game list
  $('gamesCount').textContent = data.games.length;
  $('gamesList').innerHTML = data.games.map(g => {
    const cls = g.win ? 'win' : 'loss';
    const kda = `${g.kills}/${g.deaths}/${g.assists}`;
    const result = g.win ? t('win') : t('loss');
    return `<div class="game-row ${cls}">
      <div class="bar"></div>
      <div class="g-main"><b>${g.champion}</b><span>${tRole(g.role)} · ${result}${g.remake ? ' · ' + t('remake') : ''}</span></div>
      <div class="g-kda">${kda}</div>
      <div class="g-cs">${g.csPerMin.toFixed(1)} ${t('csm')}</div>
    </div>`;
  }).join('');

  stopLoading();
  $('results').hidden = false;
}

const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const riotId = $('riotId').value.trim();
  const region = $('region').value;
  if (!riotId.includes('#')) return showError(t('errFormat'));
  localStorage.setItem('lolcoach_riotid', riotId); // remember last search
  startLoading();
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riotId, region, lang: getLang() }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || t('errFail'));
    render(data);
  } catch {
    showError(t('errServer'));
  }
});

$('gamesToggle').addEventListener('click', () => {
  const list = $('gamesList');
  list.hidden = !list.hidden;
  $('gamesToggle').classList.toggle('open', !list.hidden);
});

// ── saved accounts ─────────────────────────────────────────────────────
const ACCTS_KEY = 'lolcoach_accounts';
const getAccounts = () => { try { return JSON.parse(localStorage.getItem(ACCTS_KEY)) || []; } catch { return []; } };
const setAccounts = a => localStorage.setItem(ACCTS_KEY, JSON.stringify(a));

function renderSaved() {
  const accts = getAccounts();
  const box = $('saved');
  if (!accts.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<span class="saved-label">${t('savedTitle')}:</span> ` + accts.map((a, i) =>
    `<span class="acct"><button class="acct-load" data-i="${i}">${escapeHtml(a.riotId)} · ${a.region.toUpperCase()}</button><button class="acct-del" data-i="${i}" title="✕">✕</button></span>`
  ).join('');
}

function saveCurrent() {
  const riotId = $('riotId').value.trim();
  const region = $('region').value;
  if (!riotId.includes('#')) return showError(t('errFormat'));
  const accts = getAccounts().filter(a => !(a.riotId.toLowerCase() === riotId.toLowerCase() && a.region === region));
  accts.unshift({ riotId, region });
  setAccounts(accts.slice(0, 8));
  renderSaved();
}

$('save').addEventListener('click', saveCurrent);
$('saved').addEventListener('click', e => {
  const load = e.target.closest('.acct-load');
  const del = e.target.closest('.acct-del');
  if (load) {
    const a = getAccounts()[+load.dataset.i];
    if (a) {
      $('riotId').value = a.riotId;
      $('region').value = a.region;
      localStorage.setItem('lolcoach_region', a.region);
      $('form').requestSubmit();
    }
  } else if (del) {
    const accts = getAccounts();
    accts.splice(+del.dataset.i, 1);
    setAccounts(accts);
    renderSaved();
  }
});

// ── League news (patch + free rotation) ────────────────────────────────
let lastNews = null;
async function loadNews() {
  try {
    const region = localStorage.getItem('lolcoach_region') || 'euw1';
    lastNews = await (await fetch('/api/news?region=' + region)).json();
    renderNews();
  } catch { /* news is best-effort */ }
}
function renderNews() {
  const n = lastNews;
  if (!n || (!n.patch && !(n.rotation && n.rotation.length))) { $('news').hidden = true; return; }
  let html = '';
  if (n.patch) html += `<p class="news-line"><span class="muted">${t('patch')}:</span> <b>${n.patch}</b></p>`;
  if (n.rotation && n.rotation.length) {
    html += `<p class="news-line muted">${t('freeRotation')}:</p><div class="rotation">` +
      n.rotation.map(c => {
        const name = typeof c === 'string' ? c : c.name;
        const id = typeof c === 'string' ? null : c.id;
        const img = id ? `<img loading="lazy" src="https://ddragon.leagueoflegends.com/cdn/${n.patch}/img/champion/${id}.png" alt="${escapeHtml(name)}">` : '';
        return `<div class="rot-champ" title="${escapeHtml(name)}">${img}<span>${escapeHtml(name)}</span></div>`;
      }).join('') + '</div>';
  }
  $('newsBody').innerHTML = html;
  if (n.newsUrl) $('newsLink').href = n.newsUrl;
  $('news').hidden = false;
}

// i18n: build the language dropdown, translate static text, and re-render the
// current result, saved chips and news (labels) on switch.
buildLangSelect('lang');
applyStatic();
document.addEventListener('langchange', () => {
  if (lastData) render(lastData);
  renderSaved();
  renderNews();
});

// Prefill the last-used Riot ID so returning users don't retype it.
const savedId = localStorage.getItem('lolcoach_riotid');
if (savedId) $('riotId').value = savedId;

renderSaved();
loadRegions();
loadNews();
