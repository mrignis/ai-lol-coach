// Session recorder: watches what the coach actually sees and says during a
// real game, so a play-test can be reviewed afterwards instead of relying on
// memory. Read-only — it never changes app behaviour.
//
//   node scripts/watch-game.js            → writes watch-<timestamp>.jsonl
//
// Polls the app's own local API. /api/live is free (localhost), so it runs at
// the same 5s cadence as the widget. The tip endpoint is polled with the SAME
// cache key the widget sends, so it reads the cache instead of spending extra
// AI calls.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const LANG = process.env.LANG_CODE || 'uk';
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..',
  `watch-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.jsonl`
);

const log = obj => fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n');
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

let lastEventCount = 0;
let lastTipAt = 0;
let inGame = false;

async function get(url) {
  const t0 = Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  return { data: await r.json(), ms: Date.now() - t0 };
}

async function tick() {
  let live;
  try {
    live = await get(`${BASE}/api/live?bucket=low&lang=${LANG}`);
  } catch (e) {
    log({ ev: 'server_unreachable', err: String(e.message) });
    return;
  }
  const d = live.data;

  if (!d.inGame) {
    if (inGame) { log({ ev: 'game_ended' }); console.log('game ended'); }
    inGame = false;
    return;
  }
  if (!d.ready) return;
  if (!inGame) {
    inGame = true;
    log({ ev: 'game_started', champion: d.me?.champion, role: d.me?.role });
    console.log(`game started: ${d.me?.champion} (${d.me?.role})`);
  }

  const ctx = d.ctx || {};
  const dead = (ctx.deadEnemies || []).map(e => `${e.champion}:${e.respawnIn}s`);
  const events = ctx.timeline?.all || [];
  const seq = ctx.timeline?.seq || 0;
  const sit = (ctx.deadEnemies || []).map(e => e.champion).sort().join(',') + '|e' + seq;

  // Log a snapshot every tick: cheap, and the whole point is the timeline.
  log({
    ev: 'tick',
    clock: mmss(d.gameTimeSec),
    phase: d.phase,
    me: d.me,
    dead,
    momentum: ctx.timeline?.summary,
    newEvents: events.slice(lastEventCount),
    nudges: (d.nudges || []).map(n => n.code || n.text),
    liveMs: live.ms,
  });

  // Anything new happened → note it loudly in the console for live watching.
  for (const e of events.slice(lastEventCount)) console.log(`  ${e}`);
  lastEventCount = events.length;

  // Read the tips the app ALREADY served. Asking for tips here would add a
  // second stream of AI calls on top of the widget's and blow Groq's
  // 8000-tokens-per-minute cap — which is what made a whole session fall back
  // to templates last time.
  try {
    const l = await get(`${BASE}/api/tips-log?since=${lastTipAt}`);
    for (const t of (l.data?.tips || [])) {
      lastTipAt = Math.max(lastTipAt, t.at);
      const text = t.tip || t.code;
      log({ ev: 'tip', clock: mmss(d.gameTimeSec), source: t.source, why: t.why, hot: t.hot, text });
      console.log(`  💬 [${mmss(d.gameTimeSec)} ${t.source}] ${String(text).slice(0, 110)}`);
      if (t.source === 'template' && t.why) {
        console.log(`     ↳ fell back: ${String(t.why).slice(0, 160)}`);
      }
    }
  } catch (e) {
    log({ ev: 'tiplog_failed', err: String(e.message) });
  }
}

console.log(`recording → ${OUT}\nwaiting for a game… (Ctrl+C to stop)`);
log({ ev: 'watch_started', port: PORT, lang: LANG });
setInterval(tick, 5000);
tick();
