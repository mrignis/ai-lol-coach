

// Deep link from the home page's "strong this patch" card: a champion chip
// there is a shortcut into this lookup, so arriving with ?champ= fills the form
// and runs it rather than making the player retype what they just clicked.
function applyDeepLink() {
  const q = new URLSearchParams(location.search);
  const champ = q.get('champ');
  if (!champ) return false;
  $('bChamp').value = champ;
  const role = q.get('role');
  if (role && [...$('bRole').options].some(o => o.value === role)) $('bRole').value = role;
  const vs = q.get('vs');
  if (vs) $('bVs').value = vs;
  return true;
}

// Champion names power the autocomplete on both inputs.
async function loadChampions() {
  try {
    const { champions } = await (await fetch('/api/champions')).json();
    $('champList').innerHTML = (champions || []).map(c => `<option value="${escapeHtml(c)}">`).join('');
  } catch { /* autocomplete is a nicety, the free-text input still works */ }
}

let lastResult = null;

function renderResult(d) {
  lastResult = d;
  $('bTitle').textContent = d.vs ? `${d.champ} vs ${d.vs}` : d.champ;
  $('bPatch').textContent = d.patch ? `${t('patch')} ${d.patch}` : '';
  $('bBody').textContent = d.brief || '';
  $('bSource').textContent = d.source === 'gemini-search'
    ? t('buildsFromWeb')
    : t('buildsFromModel');
  $('bResult').hidden = false;
}

$('bForm').addEventListener('submit', async e => {
  e.preventDefault();
  const champ = $('bChamp').value.trim();
  if (!champ) return;
  $('bError').hidden = true;
  $('bResult').hidden = true;
  $('bLoading').hidden = false;
  $('bGo').disabled = true;
  try {
    const q = new URLSearchParams({
      champ, role: $('bRole').value, lang: getLang(),
    });
    const vs = $('bVs').value.trim();
    if (vs) q.set('vs', vs);
    const res = await fetch('/api/build?' + q);
    const d = await res.json();
    if (!res.ok || !d.brief) throw new Error('no brief');
    renderResult(d);
  } catch {
    $('bError').textContent = t('buildsFailed');
    $('bError').hidden = false;
  } finally {
    $('bLoading').hidden = true;
    $('bGo').disabled = false;
  }
});

buildLangSelect('lang');
applyStatic();
document.addEventListener('langchange', () => {
  // The brief itself was written in the old language — re-fetch it.
  if (lastResult) $('bForm').requestSubmit();
});

loadChampions();
if (applyDeepLink()) $('bForm').requestSubmit();
