import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Progress memory: every analysis is appended per player, so the coach can
// see TRENDS across sessions ("deaths finally dropping, vision stalled")
// instead of repeating the same speech every time. Spec §8 v0.2.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const safe = s => String(s).toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
const fileFor = id => path.join(dir, `history_${safe(id)}.json`);

export async function loadAnalyses(id) {
  try { return JSON.parse(await fs.readFile(fileFor(id), 'utf8')); } catch { return []; }
}

export async function appendAnalysis(id, record) {
  await fs.mkdir(dir, { recursive: true });
  const arr = await loadAnalyses(id);
  const last = arr[arr.length - 1];
  // Re-analyzing within 6h is the same play session (mostly the same 20
  // games) — overwrite instead of stacking duplicates that would fake a trend.
  if (last && Date.now() - new Date(last.date).getTime() < 6 * 3600 * 1000) arr.pop();
  arr.push(record);
  await fs.writeFile(fileFor(id), JSON.stringify(arr.slice(-40)));
}

const METRIC_DIR = { csPerMin: 'higher', visPerMin: 'higher', kp: 'higher', deaths: 'lower', goldPerMin: 'higher', dmgPerMin: 'higher' };

// Compare the current metrics against the average of up to 5 previous
// sessions. Returns only meaningful moves (>=3%), best news first.
export function computeTrends(history, current) {
  const prev = history.slice(-5);
  if (!prev.length) return null;
  const out = [];
  for (const key of Object.keys(METRIC_DIR)) {
    const vals = prev.map(r => r.metrics?.[key]).filter(v => Number.isFinite(v));
    if (!vals.length || !Number.isFinite(current[key])) continue;
    const from = vals.reduce((a, b) => a + b, 0) / vals.length;
    const to = current[key];
    if (!from) continue;
    const delta = (to - from) / from;
    if (Math.abs(delta) < 0.03) continue;
    const better = METRIC_DIR[key] === 'lower' ? to < from : to > from;
    out.push({ key, from, to, delta, better });
  }
  out.sort((a, b) => (b.better === a.better ? Math.abs(b.delta) - Math.abs(a.delta) : b.better ? 1 : -1));
  return out.length ? out : null;
}
