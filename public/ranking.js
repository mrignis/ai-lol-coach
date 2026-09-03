

// Region list comes from the server so it cannot drift from the platforms the
// Riot calls actually accept.
async function loadRegions() {
  const saved = localStorage.getItem('lolcoach_region') || 'na1';
  try {
    const { platforms } = await (await fetch('/api/regions')).json();
    $('lbRegion').innerHTML = platforms
      .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('');
    $('lbRegion').value = platforms.some(p => p.id === saved) ? saved : platforms[0].id;
  } catch {
    $('lbRegion').innerHTML = '<option value="na1">NA</option>';
  }
}

const APEX = ['challenger', 'grandmaster', 'master'];

// Divisions exist only below Master, and only there is the result a sample
// rather than a ranking — both controls follow the tier.
function syncTier() {
  const sub = !APEX.includes($('lbTier').value);
  $('lbDivision').hidden = !sub;
  $('lbSample').hidden = !sub;
}

function render(d) {
  const tierName = t('tier' + d.tier[0].toUpperCase() + d.tier.slice(1));
  const where = d.division ? `${tierName} ${d.division}` : tierName;
  $('lbHeading').textContent = `${where} · ${$('lbRegion').selectedOptions[0].textContent}`;
  $('lbCount').textContent = `${d.players.length} ${tPlural('ladderPlayers', d.players.length)}`;
  $('lbRows').innerHTML = d.players.map(p => `
    <tr>
      <td class="lb-place">${p.place}</td>
      <td class="lb-name">${p.name
        ? `${escapeHtml(p.name)}<span class="lb-tag">#${escapeHtml(p.tag)}</span>`
        : `<span class="muted">${escapeHtml(t('ladderUnknown'))}</span>`
      }${p.hotStreak ? ' <span class="lb-hot" title="' + escapeHtml(t('ladderHot')) + '">🔥</span>' : ''}</td>
      <td class="lb-num"><b>${p.lp}</b></td>
      <td class="lb-num">${p.wins} / ${p.losses}</td>
      <td class="lb-num">${p.winRate == null ? '—' : p.winRate + '%'}</td>
    </tr>`).join('');
  $('lbResult').hidden = false;
}

let inFlight = 0;
async function load() {
  const run = ++inFlight; // a fast switch between regions must not render stale rows
  $('lbError').hidden = true;
  $('lbResult').hidden = true;
  $('lbLoading').hidden = false;
  localStorage.setItem('lolcoach_region', $('lbRegion').value);
  try {
    const q = new URLSearchParams({
      region: $('lbRegion').value, tier: $('lbTier').value,
      queue: $('lbQueue').value, division: $('lbDivision').value,
    });
    const res = await fetch('/api/leaderboard?' + q);
    const d = await res.json();
    if (run !== inFlight) return;
    if (!res.ok || !d.players?.length) throw new Error('empty');
    render(d);
  } catch {
    if (run !== inFlight) return;
    $('lbError').textContent = t('ladderFailed');
    $('lbError').hidden = false;
  } finally {
    if (run === inFlight) $('lbLoading').hidden = true;
  }
}

for (const id of ['lbRegion', 'lbTier', 'lbQueue', 'lbDivision']) {
  $(id).addEventListener('change', load);
}
$('lbTier').addEventListener('change', syncTier);
syncTier();

buildLangSelect('lang');
applyStatic();
// Only the headings are localized — the ladder itself is names and numbers.
document.addEventListener('langchange', () => { if (!$('lbResult').hidden) load(); });

loadRegions().then(load);
