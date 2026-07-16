import https from 'node:https';
import { BENCHMARKS } from './benchmarks.js';
import { liveTip } from './llm.js';

// ─────────────────────────────────────────────────────────────────────
// League "Live Client Data API" — runs LOCALLY on the player's PC while a
// game is in progress. Official + ToS-safe: read-only game state. No memory
// reading, no injection, no automation. We only DISPLAY info and gentle
// nudges ("nudge, never decide" — spec §8 v0.5 rule).
//
// It serves a self-signed Riot cert on localhost, so rejectUnauthorized is
// off for THIS localhost call only (not global).
// ─────────────────────────────────────────────────────────────────────
const LIVE_URL = 'https://127.0.0.1:2999/liveclientdata/allgamedata';

export function fetchLiveData() {
  return new Promise((resolve, reject) => {
    const req = https.get(LIVE_URL, { rejectUnauthorized: false, timeout: 2500 }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(Object.assign(new Error('no_game'), { code: 'NOGAME' }));
      }
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', () => reject(Object.assign(new Error('no_game'), { code: 'NOGAME' })));
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('no_game'), { code: 'NOGAME' })); });
  });
}

const clamp = s => Math.max(0, Math.round(s));

// Objective respawn timings are PATCH-SENSITIVE — kept here in one place.
const DRAGON_RESPAWN = 300; // 5:00 after a dragon dies
const BARON_FIRST = 1200;   // 20:00 first spawn
const BARON_RESPAWN = 360;  // 6:00 after baron dies

function lastEventTime(events, name) {
  let t = null;
  for (const e of events) if (e.EventName === name) t = e.EventTime;
  return t;
}

// Informational prompts only — max 3, gentlest first.
// Returns {level, code, params}: the server has no UI language, so the client
// renders each code through i18n (tNudge) in whatever language is selected.
export function buildNudges(me, role, gameTime, events, gold, bucket = 'mid') {
  const min = Math.max(gameTime / 60, 0.5);
  const bench = (BENCHMARKS[role] || BENCHMARKS.MIDDLE)[bucket];
  const nudges = [];

  // Player-focused (the product's whole point: coach THIS player).
  // CS is checked from 3:00 so early-game drift is caught while it's fixable.
  const csPerMin = me.scores.creepScore / min;
  if (gameTime > 180 && role !== 'UTILITY' && csPerMin < bench.csPerMin * 0.85) {
    nudges.push({ level: 'warn', code: 'csPace', params: { cs: csPerMin.toFixed(1), target: bench.csPerMin } });
  }
  const visPerMin = (me.scores.wardScore || 0) / min;
  if (gameTime > 480 && visPerMin < bench.visPerMin * 0.7) {
    nudges.push({ level: 'warn', code: 'vision' });
  }
  if (me.scores.deaths >= 4) {
    nudges.push({ level: 'warn', code: 'deaths', params: { n: me.scores.deaths } });
  }
  if (gold >= 1400) {
    nudges.push({ level: 'info', code: 'gold', params: { gold } });
  }
  // First jungle gank window (~2:30–8:00) — flag it while there's still no vision.
  if (gameTime > 150 && gameTime < 480 && (me.scores.wardScore || 0) < 2) {
    nudges.push({ level: 'info', code: 'earlyWard' });
  }

  // Objective soft-timers (least patch-fragile: dragon + baron only).
  const lastDragon = lastEventTime(events, 'DragonKill');
  if (lastDragon != null) {
    const next = lastDragon + DRAGON_RESPAWN - gameTime;
    if (next > 0 && next <= 45) nudges.push({ level: 'info', code: 'dragon', params: { sec: clamp(next) } });
  }
  const lastBaron = lastEventTime(events, 'BaronKill');
  const baronNext = lastBaron != null ? lastBaron + BARON_RESPAWN - gameTime : BARON_FIRST - gameTime;
  if (baronNext > 0 && baronNext <= 45) nudges.push({ level: 'info', code: 'baron', params: { sec: clamp(baronNext) } });

  // Never leave the player staring at an empty widget in the first minutes.
  if (!nudges.length && gameTime < 300) nudges.push({ level: 'info', code: 'earlyFocus' });

  return nudges.slice(0, 3);
}

// Shape the raw allgamedata into what the widget needs.
export function buildLiveResponse(data, bucket = 'mid') {
  const gameTime = data.gameData?.gameTime || 0;
  const myId = data.activePlayer?.riotId || data.activePlayer?.summonerName;
  const players = data.allPlayers || [];
  const me = players.find(p => (p.riotId || p.summonerName) === myId)
    || players.find(p => p.summonerName && myId && myId.startsWith(p.summonerName));
  if (!me) return { inGame: true, ready: false };

  const role = me.position || 'MIDDLE';
  const gold = Math.round(data.activePlayer?.currentGold || 0);
  const events = data.events?.Events || [];
  const min = Math.max(gameTime / 60, 0.5);

  return {
    inGame: true,
    ready: true,
    gameTimeSec: Math.round(gameTime),
    me: {
      champion: me.championName,
      role,
      kills: me.scores.kills,
      deaths: me.scores.deaths,
      assists: me.scores.assists,
      cs: me.scores.creepScore,
      csPerMin: me.scores.creepScore / min,
      wardScore: me.scores.wardScore || 0,
      gold,
      level: data.activePlayer?.level || me.level || 0,
    },
    nudges: buildNudges(me, role, gameTime, events, gold, bucket),
  };
}

// LLM-backed single live recommendation (polled less often than the widget).
export async function liveCoachResponse(bucket = 'mid', lang = 'en') {
  const data = await fetchLiveData();
  const base = buildLiveResponse(data, bucket);
  if (!base.ready) return { inGame: base.inGame !== false, ready: false };
  const { tip, code, params, source } = await liveTip({
    me: base.me,
    gameTimeSec: base.gameTimeSec,
    role: base.me.role,
    nudges: base.nudges,
    lang,
  });
  // tip = LLM prose (already in `lang`); code/params = template the client localizes.
  return { inGame: true, ready: true, tip, code, params, source };
}
