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

// i18n: language dropdown + translate static text; re-render on switch.
buildLangSelect('lang');
applyStatic();
document.addEventListener('langchange', () => {
  if (lastLive) render(lastLive);
  else poll();
});

poll();
setInterval(poll, 5000);
