const $ = id => document.getElementById(id);

const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support', UNKNOWN: '—' };

// Staged loading messages so the wait feels alive (spec §7).
const LOADING_STEPS = [
  'finding your account…',
  'reading your last 20 games…',
  'crunching your numbers…',
  'comparing you to your rank…',
  'writing your coaching…',
];
let loadTimer = null;

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
  let i = 0;
  $('loadingText').textContent = LOADING_STEPS[0];
  loadTimer = setInterval(() => {
    i = Math.min(i + 1, LOADING_STEPS.length - 1);
    $('loadingText').textContent = LOADING_STEPS[i];
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
  const s = data.summary;

  // Summary card
  $('playerName').textContent = `${s.gameName} #${s.tagLine}`;
  const rank = s.rank ? `${cap(s.rank.tier)} ${s.rank.rank} · ${s.rank.lp} LP` : 'Unranked';
  $('playerRank').textContent = `${rank} · mostly ${ROLE_LABEL[s.mainRole] || s.mainRole}`;
  $('wrValue').textContent = pct(s.winRate);
  $('wrValue').style.color = s.winRate >= 0.5 ? 'var(--green)' : 'var(--red)';
  $('wrGames').textContent = s.gamesAnalyzed;
  $('mainChamps').innerHTML = s.mainChamps.map(c =>
    `<div class="champ"><b>${c.champion}</b><span class="cwr">${c.games}g · ${pct(c.wins / c.games)}</span></div>`
  ).join('');
  if (s.roleMixed) {
    $('roleNote').hidden = false;
    $('roleNote').textContent = '⚠ You play several roles, so numbers are blended — read the advice against your main role.';
  } else {
    $('roleNote').hidden = true;
  }
  if (s.queueScope === 'any') {
    $('roleNote').hidden = false;
    $('roleNote').textContent = 'ℹ No ranked games found — analyzing your most recent games of any queue.';
  }

  // Weakness chips
  $('chips').innerHTML = data.weaknesses.gaps.map(g => {
    const worse = g.gap > 0;
    return `<div class="chip"><span class="k">${g.label}:</span> ` +
      `<span class="v" style="color:${worse ? 'var(--red)' : 'var(--green)'}">${fmtMetric(g.key, g.player)}</span> ` +
      `<span class="t">→ target ${fmtMetric(g.key, g.target)}</span></div>`;
  }).join('');

  // Coaching text — highlight numbers lightly
  $('coachText').innerHTML = escapeHtml(data.weaknesses.coachText)
    .replace(/(\d+(?:\.\d+)?%?)/g, '<span class="num">$1</span>');
  $('coachSource').textContent = data.weaknesses.coachSource === 'template'
    ? 'coach text generated locally (LLM offline — start Ollama for richer advice)'
    : `coach text by ${data.weaknesses.coachSource}`;

  // Game list
  $('gamesCount').textContent = data.games.length;
  $('gamesList').innerHTML = data.games.map(g => {
    const cls = g.win ? 'win' : 'loss';
    const kda = `${g.kills}/${g.deaths}/${g.assists}`;
    return `<div class="game-row ${cls}">
      <div class="bar"></div>
      <div class="g-main"><b>${g.champion}</b><span>${ROLE_LABEL[g.role] || g.role} · ${g.win ? 'Win' : 'Loss'}${g.remake ? ' · remake' : ''}</span></div>
      <div class="g-kda">${kda}</div>
      <div class="g-cs">${g.csPerMin.toFixed(1)} cs/m</div>
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
  if (!riotId.includes('#')) return showError('Enter your Riot ID as Name#TAG (e.g. Faker#KR1).');
  startLoading();
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riotId, region }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Analysis failed.');
    render(data);
  } catch {
    showError('Could not reach the server. Is it running?');
  }
});

$('gamesToggle').addEventListener('click', () => {
  const list = $('gamesList');
  list.hidden = !list.hidden;
  $('gamesToggle').classList.toggle('open', !list.hidden);
});

loadRegions();
