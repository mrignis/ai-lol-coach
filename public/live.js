const $ = id => document.getElementById(id);
const ROLE_LABEL = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };

let bucket = localStorage.getItem('lolcoach_bucket') || 'mid';
$('bucket').value = bucket;
$('bucket').addEventListener('change', () => {
  bucket = $('bucket').value;
  localStorage.setItem('lolcoach_bucket', bucket);
  poll();
});

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function showWaiting(text) {
  $('widget').hidden = true;
  $('status').hidden = false;
  $('status').textContent = text;
}

function render(d) {
  $('status').hidden = true;
  $('widget').hidden = false;
  const m = d.me;
  $('liveChamp').textContent = `${m.champion} · ${ROLE_LABEL[m.role] || m.role} · Lv ${m.level}`;
  $('liveTime').textContent = mmss(d.gameTimeSec);
  $('liveStats').innerHTML = [
    ['KDA', `${m.kills}/${m.deaths}/${m.assists}`],
    ['CS', `${m.cs} (${m.csPerMin.toFixed(1)}/m)`],
    ['Vision', m.wardScore.toFixed(0)],
    ['Gold', m.gold],
  ].map(([k, v]) => `<div class="live-stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  if (!d.nudges.length) {
    $('liveNudges').innerHTML = `<div class="nudge info">You're on track — keep doing what you're doing. 👍</div>`;
  } else {
    $('liveNudges').innerHTML = d.nudges
      .map(n => `<div class="nudge ${n.level}">${n.text}</div>`)
      .join('');
  }
}

async function poll() {
  try {
    const d = await (await fetch(`/api/live?bucket=${bucket}`)).json();
    $('dot').className = 'dot on';
    if (!d.inGame) return showWaiting('Waiting for a game… launch League and load into a match.');
    if (!d.ready) return showWaiting('Game detected — loading player data…');
    render(d);
  } catch {
    $('dot').className = 'dot off';
    showWaiting('Cannot reach the coach server. Is it running?');
  }
}

poll();
setInterval(poll, 5000);
