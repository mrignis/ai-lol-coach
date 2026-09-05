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

// Below this many games in a role, the average is not worth a weakness claim —
// one bad game moves it too far. The coach is told to say so rather than
// pretending the number is solid.
export const MIN_GAMES_FOR_CONFIDENCE = 5;

// Metrics for ONE role, from that role's games only.
//
// Blending every role into one average and then judging it against a single
// role's benchmarks produced nonsense in both directions: on a real account of
// 17 support games plus one jungle and one bottom, CS/min came out at 1.98
// against the true support figure of 1.53 — 29% inflation from two off-role
// games — and the coach read that as a support farming far above expectation.
// Vision moved the other way. So each role is now averaged on its own.
export function aggregateByRole(games, role) {
  return aggregate(games.filter(g => !g.remake && g.role === role));
}

// Games per role, most-played first, so the UI can show what was actually
// analysed and what was set aside.
export function roleBreakdown(games) {
  const counts = {};
  for (const g of games) {
    if (g.remake || !g.role || g.role === 'UNKNOWN') continue;
    counts[g.role] = (counts[g.role] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([role, games]) => ({ role, games }));
}

// Average the per-game metrics of whatever games it is given. Callers pass a
// single role's games (see aggregateByRole) — handing it a mixed set is what
// caused the bug above.
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
// Only metrics the player is actually behind on. Taking a flat top-3 listed
// strengths as things to fix — a support with 2.11 vision/min against a 1.10
// target was told to work on vision. The 2% floor keeps noise out.
// At least one entry is always returned so the report is never blank.
export function topWeaknesses(gaps, count = 3) {
  const behind = gaps.filter(g => g.gap > 0.02);
  return behind.length ? behind.slice(0, count) : gaps.slice(0, 1);
}
