import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.js';

// Session recording, built into the app.
//
// This used to be a separate script the developer had to remember to start,
// and every app update killed it — one play-test lost a whole game because it
// was not running. Nothing about it needs a second process: the server already
// sees every live poll and every tip it serves, so it writes the log itself.
//
// One JSONL file per game, in the user's own data folder. Only game telemetry
// goes in — champion, score, timers, and the tips that were shown. No account
// name, no Riot ID.

const recDir = path.join(dataDir, 'recordings');
const KEEP_GAMES = 20;      // roughly a week of play; older files are pruned
const TICK_EVERY_MS = 5000; // the widget polls faster than this; one row per 5s is plenty

let stream = null;
let currentFile = null;
let lastTickAt = 0;
let lastGameTime = -1;

function write(row) {
  if (!stream) return;
  try {
    stream.write(JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
  } catch { /* a full or locked disk must never break the coach */ }
}

// Keep only the newest KEEP_GAMES recordings; a long session would otherwise
// fill the folder with files nobody reads.
function prune() {
  try {
    const files = fs.readdirSync(recDir)
      .filter(f => f.startsWith('game-') && f.endsWith('.jsonl'))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_GAMES))) {
      fs.unlinkSync(path.join(recDir, f));
    }
  } catch { /* best effort */ }
}

function open(me) {
  close();
  try {
    fs.mkdirSync(recDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    currentFile = path.join(recDir, `game-${stamp}.jsonl`);
    stream = fs.createWriteStream(currentFile, { flags: 'a' });
    write({ ev: 'game_started', champion: me?.champion, role: me?.role });
    prune();
  } catch {
    stream = null;
    currentFile = null;
  }
}

function close() {
  if (!stream) return;
  write({ ev: 'game_ended' });
  try { stream.end(); } catch { /* ignore */ }
  stream = null;
}

/**
 * Called on every /api/live response. Opens a file when a game starts, closes
 * it when the game ends, and samples the state in between.
 */
export function observeLive(payload) {
  if (!payload?.inGame) {
    if (stream) { close(); lastGameTime = -1; }
    return;
  }
  if (!payload.ready) return;

  // A clock that jumped backwards is a NEW game, not the same one continuing.
  const t = payload.gameTimeSec ?? 0;
  if (!stream || t + 60 < lastGameTime) open(payload.me);
  lastGameTime = t;

  const now = Date.now();
  if (now - lastTickAt < TICK_EVERY_MS) return;
  lastTickAt = now;

  const ctx = payload.ctx || {};
  write({
    ev: 'tick',
    clock: `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
    phase: ctx.phase,
    me: payload.me,
    dead: (ctx.deadEnemies || []).map(e => `${e.champion}:${e.respawnIn}s`),
    events: ctx.timeline?.sigSeq ?? 0,
    nudges: (payload.nudges || []).map(n => n.code),
  });
}

/** Called for every tip actually served, including the ones replayed from cache. */
export function observeTip(entry) {
  if (!stream) return;
  write({ ev: 'tip', source: entry.source, text: entry.tip || null, code: entry.code || null, why: entry.why || null });
}

/** Newest recordings first — used by the diagnostics endpoint. */
export function listRecordings() {
  try {
    return fs.readdirSync(recDir)
      .filter(f => f.startsWith('game-') && f.endsWith('.jsonl'))
      .sort().reverse()
      .map(f => {
        const st = fs.statSync(path.join(recDir, f));
        return { file: f, bytes: st.size, at: st.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

export function readRecording(file) {
  // Defend the folder: only our own generated names, never a traversal.
  if (!/^game-[\d T:.-]+\.jsonl$/.test(file)) return null;
  try {
    return fs.readFileSync(path.join(recDir, file), 'utf8');
  } catch {
    return null;
  }
}

export const recordingsDir = recDir;
