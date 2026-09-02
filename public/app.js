// Copying a Riot ID from a browser or chat carries invisible bidi/zero-width
// marks. They don't show in the input but make the Riot lookup 404.
const cleanId = s => String(s || '').replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').trim();

const $ = id => document.getElementById(id);

let loadTimer = null;
let lastData = null; // kept so switching language re-renders the current result

// Champion portraits come from Data Dragon. The patch version arrives with the
// news payload, so the last one we saw is remembered for the first paint.
let ddPatch = localStorage.getItem('lolcoach_ddpatch') || '15.1.1';
// Match-V5 champion names are Data Dragon ids apart from this one spelling.
const DD_ALIAS = { FiddleSticks: 'Fiddlesticks' };
const champIcon = id =>
  `https://ddragon.leagueoflegends.com/cdn/${ddPatch}/img/champion/${encodeURIComponent(DD_ALIAS[id] || id)}.png`;

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
  document.body.classList.remove('has-results'); // collapses the side column
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

// One "personal pattern" row: label, the two numbers, and a bar that grows
// left (red, worse) or right (green, better) out of the centre line.
function patternRow({ label, num, title, shown, better }) {
  const cls = better ? 'good' : 'bad';
  const width = Math.min(Math.abs(shown) * 100, 50); // half the track = 50% off
  const sign = shown >= 0 ? '+' : '−';
  return `<div class="pat">
    <div class="pat-top">
      <span class="pat-k">${label}</span>
      <span class="pat-num"${title ? ` title="${escapeHtml(title)}"` : ''}>${num}</span>
    </div>
    <div class="pat-bot">
      <div class="pat-track"><i class="pat-fill ${cls}" style="width:${width}%"></i></div>
      <span class="pat-v ${cls}">${sign}${Math.round(Math.abs(shown) * 100)}%</span>
    </div>
  </div>`;
}

function render(data) {
  lastData = data;
  const s = data.summary;

  // ── Personal ratings ──────────────────────────────────────────────
  $('playerName').textContent = `${s.gameName} #${s.tagLine}`;
  $('rankCard').dataset.tier = s.rank ? String(s.rank.tier).toLowerCase() : '';
  $('rankDiv').textContent = s.rank ? (s.rank.rank || '') : '';
  $('playerRank').textContent = s.rank ? `${cap(s.rank.tier)} ${s.rank.rank}` : t('unranked');
  $('rankLp').textContent = s.rank ? `${s.rank.lp} LP` : '';
  $('roleLine').textContent = `${t('mostly')} ${tRole(s.mainRole)}`;
  $('winsNum').textContent = s.wins;
  $('lossesNum').textContent = s.losses;
  $('winsWord').textContent = tPlural('winsLabel', s.wins);
  $('lossesWord').textContent = tPlural('lossesLabel', s.losses);
  $('wlBar').style.width = pct(s.winRate);

  // ── Recent form (donut) ───────────────────────────────────────────
  const wrCol = s.winRate >= 0.5 ? 'var(--green)' : 'var(--red)';
  $('wrValue').textContent = pct(s.winRate);
  $('wrValue').style.color = wrCol;
  $('wrDonut').style.setProperty('--p', Math.round(s.winRate * 100));
  $('wrDonut').style.setProperty('--wr-col', wrCol);
  $('playedNum').textContent = s.gamesAnalyzed;
  $('wrGames').textContent = s.gamesAnalyzed;

  // ── Champion rows: portrait, games bar, win rate ──────────────────
  const maxGames = Math.max(...s.mainChamps.map(c => c.games), 1);
  $('mainChamps').innerHTML = s.mainChamps.map(c => {
    const wr = c.wins / c.games;
    const col = wr >= 0.5 ? 'var(--green)' : 'var(--red)';
    return `<div class="cr">
      <img class="cr-img" loading="lazy" alt="" src="${champIcon(c.champion)}" onerror="this.classList.add('miss')">
      <div class="cr-mid">
        <div class="cr-top">
          <span class="cr-name">${escapeHtml(c.champion)}</span>
          <span class="cr-g">${c.games} ${tPlural('gamesShort', c.games)}</span>
        </div>
        <div class="cr-bar"><i style="width:${Math.round(c.games / maxGames * 100)}%"></i></div>
      </div>
      <div class="cr-end">
        <span class="cr-wr" style="color:${col}">${pct(wr)}</span>
        <span class="cr-wrbar"><i style="width:${Math.round(wr * 100)}%;background:${col}"></i></span>
      </div>
    </div>`;
  }).join('');

  // Progress vs the player's own previous sessions (needs 2+ analyses).
  // The bar follows `better`, the number keeps the real sign — so "deaths
  // −20%" reads as green, which is what it means.
  if (data.progress && data.progress.length) {
    $('progressBox').hidden = false;
    $('progressChips').innerHTML = data.progress.map(p => patternRow({
      label: tMetric(p.key),
      num: `${fmtMetric(p.key, p.from)} → ${fmtMetric(p.key, p.to)}`,
      shown: p.delta,
      better: p.better,
    })).join('');
  } else {
    $('progressBox').hidden = true;
  }

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

  // Personal patterns: distance from the benchmark for the player's rank.
  // g.gap is positive when the player is behind it, so flip it for display.
  $('chips').innerHTML = data.weaknesses.gaps.map(g => patternRow({
    label: tMetric(g.key),
    num: `${fmtMetric(g.key, g.player)} → ${fmtMetric(g.key, g.target)}`,
    title: `${t('target')} ${fmtMetric(g.key, g.target)}`,
    shown: -g.gap,
    better: g.gap <= 0,
  })).join('');

  // Coaching text — localize the offline template; LLM output is already localized.
  const coachText = data.weaknesses.coachSource === 'template'
    ? templateCoach(data.weaknesses.gaps, data.weaknesses.role || s.mainRole)
    : data.weaknesses.coachText;
  // The LLM writes **bold** markdown; render it instead of printing asterisks.
  $('coachText').innerHTML = escapeHtml(coachText)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(\d+(?:\.\d+)?%?)/g, '<span class="num">$1</span>');
  $('coachSource').textContent = data.weaknesses.coachSource === 'template'
    ? t('coachLocal')
    : `${t('coachBy')} ${data.weaknesses.coachSource}`;

  // Game list
  $('gamesCount').textContent = data.games.length;
  $('gamesWord').textContent = tPlural('lastPost', data.games.length);
  $('gamesList').innerHTML = data.games.map(g => {
    const cls = g.win ? 'win' : 'loss';
    const kda = `${g.kills}/${g.deaths}/${g.assists}`;
    const result = g.win ? t('win') : t('loss');
    return `<div class="game-row ${cls}">
      <div class="bar"></div>
      <img class="g-img" loading="lazy" alt="" src="${champIcon(g.champion)}" onerror="this.classList.add('miss')">
      <div class="g-main"><b>${escapeHtml(g.champion)}</b><span>${tRole(g.role)} · ${result}${g.remake ? ' · ' + t('remake') : ''}</span></div>
      <div class="g-kda">${kda}</div>
      <div class="g-cs">${g.csPerMin.toFixed(1)} ${t('csm')}</div>
    </div>`;
  }).join('');

  stopLoading();
  $('results').hidden = false;
  document.body.classList.add('has-results'); // reveals the side column
}

const cap = s => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

let lastQuery = null; // {riotId, region} so a language switch can re-run it

async function runAnalysis(riotId, region, { silent = false } = {}) {
  lastQuery = { riotId, region };
  if (!silent) startLoading();
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riotId, region, lang: getLang() }),
    });
    const data = await res.json();
    if (!res.ok) { if (!silent) showError(data.code ? t('err_' + data.code) : (data.error || t('errFail'))); return; }
    render(data);
  } catch {
    if (!silent) showError(t('errServer'));
  }
}

$('form').addEventListener('submit', e => {
  e.preventDefault();
  const riotId = cleanId($('riotId').value);
  const region = $('region').value;
  if (!riotId.includes('#')) return showError(t('errFormat'));
  localStorage.setItem('lolcoach_riotid', riotId); // remember last search
  runAnalysis(riotId, region);
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
  const riotId = cleanId($('riotId').value);
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
      $('riotId').value = cleanId(a.riotId); // entries saved before the fix
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

// ── desktop launcher bar ───────────────────────────────────────────────
// /api/app/* only exists when Electron is hosting the server, so a plain
// browser silently skips this and the page stays a normal web app.
let appStatus = null;
async function pollAppStatus() {
  try {
    const res = await fetch('/api/app/status');
    if (!res.ok) return;
    appStatus = await res.json();
    renderLauncherBar();
  } catch { /* browser mode */ }
}
function renderLauncherBar() {
  if (!appStatus?.desktop) return;
  $('launcherBar').hidden = false;
  $('lbGame').textContent = appStatus.inGame ? t('lbInGame') : t('lbNoGame');
  $('lbWidget').textContent = appStatus.widgetVisible ? t('lbHideWidget') : t('lbShowWidget');
}
$('lbWidget').addEventListener('click', async () => {
  try {
    await fetch('/api/app/widget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle' }),
    });
  } catch { /* ignore */ }
  pollAppStatus();
});

// An installed build ships without keys, so say exactly which file to edit
// rather than letting the news and rotation silently stay empty.
async function checkKeys() {
  try {
    const h = await (await fetch('/api/health')).json();
    if (h.riotKey && h.aiKey) return;
    const missing = [!h.riotKey && 'RIOT_API_KEY', !h.aiKey && 'GROQ_API_KEY'].filter(Boolean).join(' + ');
    $('keyWarn').textContent = `${t('keyMissing')} ${missing} — ${h.envPath}`;
    $('keyWarn').hidden = false;
  } catch { /* ignore */ }
}

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
  // The news payload carries the live Data Dragon version — reuse it for the
  // champion portraits, and repaint a result that was drawn with the old one.
  if (n.patch && n.patch !== ddPatch) {
    ddPatch = n.patch;
    localStorage.setItem('lolcoach_ddpatch', ddPatch);
    if (lastData && $('loading').hidden) render(lastData); // never cut a run short
  }
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
  if (lastData) render(lastData); // instant: chips, summary, template coach
  renderSaved();
  renderNews();
  renderLauncherBar();
  // The AI coach text was written in the previous language and render() can't
  // re-translate it — re-run the analysis so the whole report matches. Matches
  // are cached server-side, so this is basically one fresh AI call.
  if (lastData && lastData.weaknesses.coachSource !== 'template' && lastQuery) {
    runAnalysis(lastQuery.riotId, lastQuery.region, { silent: true });
  }
});

// Prefill the last-used Riot ID so returning users don't retype it.
const savedId = cleanId(localStorage.getItem('lolcoach_riotid'));
if (savedId) $('riotId').value = savedId;

// Scrub IDs stored before the invisible-character fix, so an old saved chip
// doesn't keep failing with a name that looks perfectly correct.
(() => {
  const accts = getAccounts();
  const cleaned = accts.map(a => ({ ...a, riotId: cleanId(a.riotId) }));
  if (JSON.stringify(cleaned) !== JSON.stringify(accts)) {
    setAccounts(cleaned);
    renderSaved();
  }
})();

renderSaved();
loadRegions();
loadNews();
checkKeys();
pollAppStatus();
setInterval(pollAppStatus, 5000);
