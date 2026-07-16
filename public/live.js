const $ = id => document.getElementById(id);

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
    $('liveNudges').innerHTML = `<div class="nudge info">${t('onTrack')}</div>`;
  } else {
    $('liveNudges').innerHTML = d.nudges
      .map(n => `<div class="nudge ${n.level}">${n.text}</div>`)
      .join('');
  }
}

async function poll() {
  try {
    const d = await (await fetch(`/api/live?bucket=${bucket}&lang=${getLang()}`)).json();
    $('dot').className = 'dot on';
    if (!d.inGame) { lastLive = null; return showWaiting(t('waiting')); }
    if (!d.ready) { lastLive = null; return showWaiting(t('detected')); }
    render(d);
  } catch {
    $('dot').className = 'dot off';
    lastLive = null;
    showWaiting(t('noServer'));
  }
}

// AI recommendation — polled less often (LLM call is heavier than the widget).
async function loadAiTip() {
  try {
    const d = await (await fetch(`/api/live-coach?bucket=${bucket}&lang=${getLang()}`)).json();
    if (d.inGame && d.ready && d.tip) $('aiTip').textContent = d.tip;
  } catch { /* best-effort */ }
}

// ── Overlay mode (?overlay=1): transparent, compact, user-configurable ──
const OV_KEY = 'lolcoach_overlay_opts';
const OV_DEFAULTS = { alpha: 85, scale: 100, stats: true, nudges: true, ai: true };
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
  localStorage.setItem(OV_KEY, JSON.stringify(ovOpts));
}

if (new URLSearchParams(location.search).get('overlay') === '1') {
  document.body.classList.add('overlay');
  $('ovBar').hidden = false;
  $('ovClose').addEventListener('click', () => window.close());
  $('ovGear').addEventListener('click', () => { $('ovSettings').hidden = !$('ovSettings').hidden; });

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
  applyOpts();
}

// i18n: language dropdown + translate static text; re-render on switch.
buildLangSelect('lang');
applyStatic();
document.addEventListener('langchange', () => {
  if (lastLive) { render(lastLive); loadAiTip(); }
  else poll();
});

poll();
setInterval(poll, 5000);
loadAiTip();
setInterval(loadAiTip, 60000);
