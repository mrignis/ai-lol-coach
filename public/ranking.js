

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
let refill = null;

// The server answers immediately with the names it already had and resolves
// the rest at a pace Riot's rate limit allows, so the table is on screen in
// well under a second and fills in as they arrive.
function scheduleRefill(run, tries) {
  clearTimeout(refill);
  if (tries <= 0) return;
  refill = setTimeout(() => { if (run === inFlight) load({ quiet: true, tries: tries - 1 }); }, 4000);
}

// 25 refills at 4s covers the ~90s a cold region of fifty names actually takes.
// A refill costs one cache read per row and no Riot call, so it is nearly free.
async function load({ quiet = false, tries = 25 } = {}) {
  clearTimeout(refill); // a manual switch cancels a pending refill
  const run = ++inFlight; // a fast switch between regions must not render stale rows
  $('lbError').hidden = true;
  // A refill redraws in place; only a real switch clears the table first.
  if (!quiet) {
    $('lbResult').hidden = true;
    $('lbLoading').hidden = false;
  }
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
    if (d.pending > 0) scheduleRefill(run, tries);
  } catch {
    if (run !== inFlight || quiet) return; // a failed refill keeps the table
    $('lbError').textContent = t('ladderFailed');
    $('lbError').hidden = false;
  } finally {
    if (run === inFlight) $('lbLoading').hidden = true;
  }
}

// ── "Where am I" ──────────────────────────────────────────────────────
// The sub-Master list is one page out of hundreds of thousands, so nobody
// finds themselves in it. Asking Riot for the one player is the only answer.
$('lbMeId').value = localStorage.getItem('lolcoach_riotid') || '';

async function findMe() {
  const riotId = cleanId($('lbMeId').value);
  if (!riotId.includes('#')) return;
  $('lbMe').hidden = false;
  $('lbMe').textContent = t('ladderLoading');
  $('lbMeGo').disabled = true;
  try {
    const q = new URLSearchParams({ riotId, region: $('lbRegion').value });
    const d = await (await fetch('/api/myrank?' + q)).json();
    if (!d.rank) { $('lbMe').textContent = t('unranked'); return; }
    const r = d.rank;
    const tierKey = 'tier' + r.tier[0] + r.tier.slice(1).toLowerCase();
    const games = r.wins + r.losses;
    $('lbMe').innerHTML = `<b>${escapeHtml(riotId)}</b> · `
      + `${escapeHtml(t(tierKey) || r.tier)} ${escapeHtml(r.rank)} · `
      + `<b class="num">${r.lp}</b> ${escapeHtml(t('ladderLp'))} · `
      + `${r.wins}/${r.losses} · ${games ? Math.round((r.wins / games) * 100) : 0}%`;
    localStorage.setItem('lolcoach_riotid', riotId);
  } catch {
    $('lbMe').textContent = t('ladderFailed');
  } finally {
    $('lbMeGo').disabled = false;
  }
}

$('lbMeGo').addEventListener('click', findMe);
$('lbMeId').addEventListener('keydown', e => { if (e.key === 'Enter') findMe(); });

for (const id of ['lbRegion', 'lbTier', 'lbQueue', 'lbDivision']) {
  $(id).addEventListener('change', () => load());
}
$('lbTier').addEventListener('change', syncTier);
syncTier();

buildLangSelect('lang');
applyStatic();
// Only the headings are localized — the ladder itself is names and numbers.
document.addEventListener('langchange', () => { if (!$('lbResult').hidden) load(); });

loadRegions().then(() => load());
