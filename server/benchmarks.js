// ─────────────────────────────────────────────────────────────────────
// BENCHMARKS — the single editable config the owner tunes from real tests.
//
// Shape: BENCHMARKS[ROLE][bucket] = { metric: target, ... }
// Roles are Riot's teamPosition values: TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY.
// Buckets map from rank tier (see engine.tierBucket):
//   low  = Iron / Bronze / Silver
//   mid  = Gold / Platinum
//   high = Emerald+ (Emerald, Diamond, Master, GM, Challenger)
//
// Numbers are a rough first pass — edit freely, the engine reads them live.
// ─────────────────────────────────────────────────────────────────────
export const BENCHMARKS = {
  TOP: {
    low:  { csPerMin: 5.0, visPerMin: 0.35, kp: 0.45, deaths: 6.5, goldPerMin: 340, dmgPerMin: 450 },
    mid:  { csPerMin: 6.2, visPerMin: 0.45, kp: 0.50, deaths: 5.5, goldPerMin: 390, dmgPerMin: 560 },
    high: { csPerMin: 7.2, visPerMin: 0.55, kp: 0.55, deaths: 5.0, goldPerMin: 430, dmgPerMin: 650 },
  },
  JUNGLE: {
    low:  { csPerMin: 4.5, visPerMin: 0.55, kp: 0.55, deaths: 6.5, goldPerMin: 340, dmgPerMin: 380 },
    mid:  { csPerMin: 5.5, visPerMin: 0.70, kp: 0.60, deaths: 5.5, goldPerMin: 380, dmgPerMin: 470 },
    high: { csPerMin: 6.3, visPerMin: 0.90, kp: 0.65, deaths: 5.0, goldPerMin: 420, dmgPerMin: 560 },
  },
  MIDDLE: {
    low:  { csPerMin: 5.5, visPerMin: 0.45, kp: 0.50, deaths: 6.5, goldPerMin: 360, dmgPerMin: 500 },
    mid:  { csPerMin: 6.8, visPerMin: 0.55, kp: 0.55, deaths: 5.5, goldPerMin: 400, dmgPerMin: 620 },
    high: { csPerMin: 7.8, visPerMin: 0.65, kp: 0.60, deaths: 5.0, goldPerMin: 440, dmgPerMin: 720 },
  },
  BOTTOM: {
    low:  { csPerMin: 5.8, visPerMin: 0.40, kp: 0.50, deaths: 6.0, goldPerMin: 370, dmgPerMin: 520 },
    mid:  { csPerMin: 7.0, visPerMin: 0.50, kp: 0.55, deaths: 5.0, goldPerMin: 410, dmgPerMin: 640 },
    high: { csPerMin: 8.0, visPerMin: 0.60, kp: 0.60, deaths: 4.5, goldPerMin: 450, dmgPerMin: 740 },
  },
  UTILITY: {
    low:  { csPerMin: 1.2, visPerMin: 1.1, kp: 0.55, deaths: 7.0, goldPerMin: 250, dmgPerMin: 180 },
    mid:  { csPerMin: 1.0, visPerMin: 1.4, kp: 0.60, deaths: 6.0, goldPerMin: 270, dmgPerMin: 220 },
    high: { csPerMin: 0.9, visPerMin: 1.8, kp: 0.65, deaths: 5.5, goldPerMin: 290, dmgPerMin: 260 },
  },
};

// Metric metadata: label, better-direction, formatter, and which roles it
// counts as a weakness for (CS/gold/damage aren't weaknesses for supports).
export const METRICS = {
  csPerMin:   { label: 'CS per min',         dir: 'higher', roles: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM'], fmt: v => v.toFixed(1) },
  visPerMin:  { label: 'Vision score / min', dir: 'higher', roles: 'all',                                  fmt: v => v.toFixed(2) },
  kp:         { label: 'Kill participation', dir: 'higher', roles: 'all',                                  fmt: v => Math.round(v * 100) + '%' },
  deaths:     { label: 'Deaths per game',    dir: 'lower',  roles: 'all',                                  fmt: v => v.toFixed(1) },
  goldPerMin: { label: 'Gold / min',         dir: 'higher', roles: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM'], fmt: v => String(Math.round(v)) },
  dmgPerMin:  { label: 'Damage / min',       dir: 'higher', roles: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM'], fmt: v => String(Math.round(v)) },
};
