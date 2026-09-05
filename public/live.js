
let bucket = localStorage.getItem('lolcoach_bucket') || 'mid';
$('bucket').value = bucket;
$('bucket').addEventListener('change', () => {
  bucket = $('bucket').value;
  localStorage.setItem('lolcoach_bucket', bucket);
  poll();
});

let lastLive = null; // last in-game payload, so a language switch re-renders it

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function showWaiting(text) {
  $('widget').hidden = true;
  $('status').hidden = false;
  $('status').textContent = text;
}

function render(d) {
  lastLive = d;
  $('status').hidden = true;
  $('widget').hidden = false;
  const m = d.me;
  $('liveChamp').textContent = `${m.champion} · ${tRole(m.role)} · Lv ${m.level}`;
  $('liveTime').textContent = mmss(d.gameTimeSec);
  $('liveStats').innerHTML = [
    [t('statKDA'), `${m.kills}/${m.deaths}/${m.assists}`],
    [t('statCS'), `${m.cs} (${m.csPerMin.toFixed(1)}/m)`],
    [t('statVision'), m.wardScore.toFixed(0)],
    [t('statGold'), m.gold],
  ].map(([k, v]) => `<div class="live-stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  if (!d.nudges.length) {
    $('liveNudges').innerHTML = `<div class="nudge info">${escapeHtml(t('onTrack'))}</div>`;
  } else {
    // The server sends {code, params}; render them in the current language.
    $('liveNudges').innerHTML = d.nudges
      .map(n => `<div class="nudge ${n.level}">${escapeHtml(n.text || tNudge(n.code, n.params))}</div>`)
      .join('');
  }
}


// Matchup briefing — fetched once per game (server caches per patch anyway).
let matchupLoadedFor = null;
async function loadMatchup() {
  try {
    const d = await (await fetch(`/api/matchup?lang=${getLang()}`)).json();
    if (d.ready && d.brief) {
      $('matchupVs').textContent = d.vs ? `${d.champ} vs ${d.vs}` : d.champ;
      $('matchupBody').textContent = d.brief;
      $('cardMatchup').hidden = false;
    }
  } catch { /* best-effort */ }
}

async function poll() {
  try {
    const d = await (await fetch(`/api/live?bucket=${bucket}&lang=${getLang()}`)).json();
    $('dot').className = 'dot on';
    if (!d.inGame) {
      lastLive = null;
      matchupLoadedFor = null;
      $('cardMatchup').hidden = true;
      return showWaiting(t('waiting'));
    }
    if (!d.ready) { lastLive = null; return showWaiting(t('detected')); }
    const prevDead = deadSignature(); // from the previous poll, before render
    render(d);
    // A kill opens a window worth acting on for only ~30-50s. Waiting for the
    // 30s tip timer meant the advice often landed after the enemy respawned,
    // so a change in who is dead asks for a fresh tip immediately.
    if (deadSignature() !== prevDead) loadAiTip();
    // First ready poll of a new game → pull the briefing for this champion.
    const gameKey = d.me.champion + ':' + getLang();
    if (matchupLoadedFor !== gameKey) {
      matchupLoadedFor = gameKey;
      loadMatchup();
    }
  } catch {
    $('dot').className = 'dot off';
    lastLive = null;
    showWaiting(t('noServer'));
  }
}

// AI recommendation — polled less often (LLM call is heavier than the widget).
// Skipped entirely when the AI section is switched off, so we don't burn LLM
// calls (and cloud quota) on a card nobody is looking at.
let lastAi = null;
// Which enemies are dead right now, as a stable key. The server uses it as
// part of its cache identity so a tip about a respawn window can't be replayed
// after that window closed.
function deadSignature() {
  const dead = lastLive?.ctx?.deadEnemies || [];
  // Event count included: a kill, an objective or a purchase should refresh the
  // advice too, not only someone being dead. Without it the tip lagged behind
  // fights and felt stale in the late game.
  // sigSeq, not seq: an item purchase should not spend an AI call.
  const events = lastLive?.ctx?.timeline?.sigSeq || 0;
  return dead.map(e => e.champion).sort().join(',') + '|e' + events;
}

// Paced for readability and cost, not for a provider cap: OpenAI allows
// 500 calls a minute and we use three. A play-test left the same tip on
// screen for 35-60s, which read as the widget having frozen, so the floor
// came down to 12s and the quiet-stretch timer to 18s.
let lastTipAt = 0;
const MIN_TIP_GAP = 12000;

async function loadAiTip(force = false) {
  if (!ovOpts.ai) return;
  if (!force && Date.now() - lastTipAt < MIN_TIP_GAP) return;
  lastTipAt = Date.now();
  try {
    const sit = encodeURIComponent(deadSignature());
    const hot = (lastLive?.ctx?.deadEnemies || []).length ? 1 : 0;
    // A truly quiet stretch — nobody dead and no objective about to spawn — is
    // told apart from a merely calm one, so the server can let a still-correct
    // tip stand instead of paying for a reworded copy of it. Measured: a fifth
    // of a game's tips were the timer firing with nothing at all having changed.
    const baron = lastLive?.ctx?.baronUpIn;
    const soon = Number.isFinite(baron) && baron > 0 && baron < 45 ? 1 : 0;
    const d = await (await fetch(
      `/api/live-coach?bucket=${bucket}&lang=${getLang()}&sit=${sit}&hot=${hot}&soon=${soon}`)).json();
    if (!d.inGame || !d.ready) { lastAi = null; return; }
    lastAi = d;
    renderAiTip();
  } catch { /* best-effort */ }
}

// Overlay mode is decided at load and read from several places below.
const IS_OVERLAY = new URLSearchParams(location.search).get('overlay') === '1';

// A short history was added because one line at a time felt like "too few
// tips" — but that was the launcher page, where there is room to spare. Over
// the game the same three lines are three times the rectangle sitting on top
// of the match, and the two older ones are advice that has already expired.
// So: only the current tip on the overlay, history where it costs nothing.
const AI_KEEP = IS_OVERLAY ? 1 : 3;
let aiHistory = [];

function renderAiTip() {
  if (!lastAi) return;
  // `tip` is LLM prose (already written in the chosen language); when the LLM is
  // offline the server sends a `code` instead, which we localize here.
  const text = lastAi.tip || tNudge(lastAi.code, lastAi.params);
  if (!aiHistory.length || aiHistory[0].text !== text) {
    aiHistory.unshift({ text, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    aiHistory = aiHistory.slice(0, AI_KEEP);
  }
  $('aiTip').innerHTML = aiHistory.map((h, i) =>
    `<div class="ai-item${i ? ' ai-old' : ''}"><span class="ai-at">${h.at}</span>${escapeHtml(h.text)}</div>`
  ).join('');
}

// ── Overlay mode (?overlay=1): transparent, compact, user-configurable ──
const OV_KEY = 'lolcoach_overlay_opts';
const OV_DEFAULTS = { alpha: 85, scale: 100, stats: true, nudges: true, ai: true, pinned: false };
let ovOpts = (() => {
  try { return { ...OV_DEFAULTS, ...JSON.parse(localStorage.getItem(OV_KEY) || '{}') }; }
  catch { return { ...OV_DEFAULTS }; }
})();

function applyOpts() {
  document.body.style.setProperty('--ov-alpha', ovOpts.alpha / 100);
  document.body.style.zoom = ovOpts.scale / 100;
  $('cardStats').hidden = !ovOpts.stats;
  $('cardNudges').hidden = !ovOpts.nudges;
  $('cardAi').hidden = !ovOpts.ai;
  // Pinned = the title bar stops being a drag region, so the widget can't be
  // moved by a stray mid-game click. Position itself persists on the Electron side.
  document.body.classList.toggle('pinned', !!ovOpts.pinned);
  $('ovPin').classList.toggle('on', !!ovOpts.pinned);
  localStorage.setItem(OV_KEY, JSON.stringify(ovOpts));
}

if (IS_OVERLAY) {
  document.body.classList.add('overlay');
  $('ovBar').hidden = false;
  $('ovClose').addEventListener('click', () => window.close());
  $('ovGear').addEventListener('click', () => { $('ovSettings').hidden = !$('ovSettings').hidden; });
  $('ovPin').addEventListener('click', () => { ovOpts.pinned = !ovOpts.pinned; applyOpts(); });

  // Reuse the existing controls: dot goes to the title bar, rank picker into settings.
  $('ovDotSlot').appendChild($('dot'));
  $('ovBarSlot').appendChild(document.querySelector('.live-bar'));

  const bind = (id, prop, key, ev) => {
    const el = $(id);
    el[prop] = ovOpts[key];
    el.addEventListener(ev, () => {
      ovOpts[key] = prop === 'checked' ? el.checked : +el.value;
      applyOpts();
    });
  };
  bind('optAlpha', 'value', 'alpha', 'input');
  bind('optScale', 'value', 'scale', 'input');
  bind('optStats', 'checked', 'stats', 'change');
  bind('optNudges', 'checked', 'nudges', 'change');
  bind('optAi', 'checked', 'ai', 'change');
  // Switching AI back on should fill the card now, not at the next 60s tick.
  $('optAi').addEventListener('change', () => { if (ovOpts.ai) loadAiTip(true); });
  applyOpts();
}

// i18n: language dropdown + translate static text; re-render on switch.
buildLangSelect('lang');
applyStatic();
document.addEventListener('langchange', () => {
  // Drop AI text written in the previous language — otherwise the panel shows
  // a mix (fresh tip in the new language above stale ones in the old).
  aiHistory = [];
  lastAi = null;
  $('aiTip').textContent = t('aiWait');
  matchupLoadedFor = null;      // re-fetch the matchup brief in the new language
  $('cardMatchup').hidden = true;
  if (lastLive) { render(lastLive); loadAiTip(true); }
  else poll();
});

poll();
setInterval(poll, 5000);
loadAiTip(true);
setInterval(loadAiTip, 18000); // a quiet stretch still refreshes; see MIN_TIP_GAP
