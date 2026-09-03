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

let lastSit = null;
let lastTip = null;
let lastEventCount = 0;
let inGame = false;
let tipTimer = 0;

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

  // Ask for the tip the way the widget does (same key ⇒ same cache entry).
  const changed = sit !== lastSit;
  if (changed || Date.now() - tipTimer > 30000) {
    lastSit = sit;
    tipTimer = Date.now();
    try {
      const hot = (ctx.deadEnemies || []).length ? 1 : 0;
      const tip = await get(`${BASE}/api/live-coach?bucket=low&lang=${LANG}&sit=${encodeURIComponent(sit)}&hot=${hot}`);
      const text = tip.data?.tip || tip.data?.code || null;
      if (text && text !== lastTip) {
        lastTip = text;
        log({ ev: 'tip', clock: mmss(d.gameTimeSec), trigger: changed ? 'event' : 'timer', source: tip.data?.source, ms: tip.ms, text });
        console.log(`  💬 [${mmss(d.gameTimeSec)} ${tip.data?.source} ${tip.ms}ms] ${String(text).slice(0, 120)}`);
      }
    } catch (e) {
      log({ ev: 'tip_failed', err: String(e.message) });
    }
  }
}

console.log(`recording → ${OUT}\nwaiting for a game… (Ctrl+C to stop)`);
log({ ev: 'watch_started', port: PORT, lang: LANG });
setInterval(tick, 5000);
tick();
