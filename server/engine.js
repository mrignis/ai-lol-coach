import { BENCHMARKS, METRICS } from './benchmarks.js';

// Map a ranked tier to a benchmark bucket.
export function tierBucket(tier) {
  const t = (tier || '').toUpperCase();
  if (['IRON', 'BRONZE', 'SILVER'].includes(t)) return 'low';
  if (['GOLD', 'PLATINUM'].includes(t)) return 'mid';
  if (['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(t)) return 'high';
  return 'mid'; // unranked / unknown → sensible middle default
}

// Most-played role across the analyzed games (ignores UNKNOWN + remakes).
export function mainRole(games) {
  const counts = {};
  for (const g of games) {
    if (g.remake || !g.role || g.role === 'UNKNOWN') continue;
    counts[g.role] = (counts[g.role] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return { role: sorted[0]?.[0] || 'MIDDLE', gamesInRole: sorted[0]?.[1] || 0, spread: sorted };
}

// Average the per-game metrics.
// NOTE (role-mixing): v0.1 averages across every role the player queued.
// A player who flexes top+support has both pools blended into one number,
// which dilutes the signal. v0.2 should segment metrics by role. Benchmarks
// here are keyed to the player's MAIN role only — flagged for the coach text.
export function aggregate(games) {
  const played = games.filter(g => !g.remake);
  const n = played.length;
  const avg = f => (n ? played.reduce((a, g) => a + f(g), 0) / n : 0);

  const metrics = {
    csPerMin: avg(g => g.csPerMin),
    visPerMin: avg(g => g.visPerMin),
    kp: avg(g => g.kp),
    deaths: avg(g => g.deaths),
    goldPerMin: avg(g => g.goldPerMin),
    dmgPerMin: avg(g => g.dmgPerMin),
  };

  // Consistency signal: coefficient of variation. High swing = tilt/inconsistency.
  const cv = (f, mean) => {
    if (!n || !mean) return 0;
    const variance = played.reduce((a, g) => a + Math.pow(f(g) - mean, 2), 0) / n;
    return Math.sqrt(variance) / mean;
  };
  metrics._consistency = {
    csPerMin: cv(g => g.csPerMin, metrics.csPerMin),
    deaths: cv(g => g.deaths, metrics.deaths),
  };
  metrics._gamesUsed = n;
  return metrics;
}

// For each role-relevant metric, compute how far the player sits from the
// benchmark, normalized so a 30%-below-CS gap outranks a 5%-below-vision gap.
export function rankGaps(metrics, role, bucket) {
  const bench = (BENCHMARKS[role] || BENCHMARKS.MIDDLE)[bucket];
  const gaps = [];
  for (const [key, meta] of Object.entries(METRICS)) {
    if (meta.roles !== 'all' && !meta.roles.includes(role)) continue;
    const player = metrics[key];
    const target = bench[key];
    if (target == null) continue;
    // Positive gap = worse than benchmark, for both directions.
    const gap = meta.dir === 'higher' ? (target - player) / target : (player - target) / target;
    gaps.push({ key, label: meta.label, player, target, gap, dir: meta.dir });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  return gaps;
}

// The top 3 gaps are the player's personal weaknesses.
export function topWeaknesses(gaps, count = 3) {
  return gaps.slice(0, count);
}
