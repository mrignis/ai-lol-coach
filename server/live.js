import https from 'node:https';
import { BENCHMARKS } from './benchmarks.js';
import { liveTip } from './llm.js';
import { getChampions, isAP } from './ddragon.js';

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
const SOUL_AT = 4;          // dragons needed for Soul

function lastEventTime(events, name) {
  let t = null;
  for (const e of events) if (e.EventName === name) t = e.EventTime;
  return t;
}

// Laning → mid → late. Advice that helps at 5:00 is noise at 30:00.
export function gamePhase(gameTime) {
  if (gameTime < 840) return 'early';   // < 14:00
  if (gameTime < 1500) return 'mid';    // < 25:00
  return 'late';
}

// Structure names encode the OWNING team: T1 = ORDER (blue), T2 = CHAOS (red).
// A destroyed T1 turret therefore scores for CHAOS.
const scorerOf = name => (/T1/.test(name || '') ? 'CHAOS' : 'ORDER');

// Read the whole board, not just the player. This is what makes advice
// situational instead of generic — the LLM and the rules both consume it.
// Item gold is the honest way to read who is actually ahead: Live Client Data
// gives every item's real price, so no static price table can go stale.
const itemGold = p => (p.items || []).reduce((a, it) => a + (it.price || 0) * (it.count || 1), 0);

export async function gameContext(data, me) {
  const gameTime = data.gameData?.gameTime || 0;
  const players = data.allPlayers || [];
  const events = data.events?.Events || [];
  const myTeam = me.team;
  const teamOf = {};
  for (const p of players) teamOf[p.riotId || p.summonerName] = p.team;

  const mine = players.filter(p => p.team === myTeam);
  const foes = players.filter(p => p.team !== myTeam);
  const sumKills = arr => arr.reduce((a, p) => a + (p.scores?.kills || 0), 0);
  const avgLevel = arr => (arr.length ? arr.reduce((a, p) => a + (p.level || 0), 0) / arr.length : 0);

  const objectives = { dragons: { ORDER: 0, CHAOS: 0 }, barons: { ORDER: 0, CHAOS: 0 }, turrets: { ORDER: 0, CHAOS: 0 }, inhibs: { ORDER: 0, CHAOS: 0 } };
  for (const e of events) {
    if (e.EventName === 'DragonKill' || e.EventName === 'BaronKill') {
      const t = teamOf[e.KillerName];
      if (!t) continue;
      objectives[e.EventName === 'DragonKill' ? 'dragons' : 'barons'][t]++;
    } else if (e.EventName === 'TurretKilled') {
      objectives.turrets[scorerOf(e.TurretKilled)]++;
    } else if (e.EventName === 'InhibKilled') {
      objectives.inhibs[scorerOf(e.InhibKilled)]++;
    }
  }
  const enemyTeam = myTeam === 'ORDER' ? 'CHAOS' : 'ORDER';

  // The single scariest enemy — worth naming, it changes how you move.
  const fed = foes.slice().sort((a, b) =>
    (b.scores.kills * 2 + b.scores.assists) - (a.scores.kills * 2 + a.scores.assists))[0];

  const lastBaron = lastEventTime(events, 'BaronKill');
  const baronUpIn = lastBaron != null ? lastBaron + BARON_RESPAWN - gameTime : BARON_FIRST - gameTime;

  // ── deep analysis: items, damage profile, defenses, nemesis ──────────
  const teamItemGold = arr => arr.reduce((a, p) => a + itemGold(p), 0);
  const myGold = teamItemGold(mine);
  const foeGold = teamItemGold(foes);

  // Which damage type is actually hitting you? Drives the defensive-item call.
  let apCount = 0;
  try {
    const champs = await getChampions();
    apCount = foes.filter(p => isAP(p.championName, champs)).length;
  } catch { /* Data Dragon offline — skip itemization advice, everything else still works */ }
  const adCount = foes.length - apCount;

  const stats = data.activePlayer?.championStats || {};
  const myName = me.riotId || me.summonerName;

  // Who keeps killing you — a Bronze-defining pattern worth naming out loud.
  const killsOnMe = {};
  let myKillsFromEvents = 0;
  for (const e of events) {
    if (e.EventName !== 'ChampionKill') continue;
    if (e.VictimName === myName && e.KillerName) killsOnMe[e.KillerName] = (killsOnMe[e.KillerName] || 0) + 1;
    if (e.KillerName === myName) myKillsFromEvents++;
  }
  const nemesisId = Object.keys(killsOnMe).sort((a, b) => killsOnMe[b] - killsOnMe[a])[0];
  const nemesisPlayer = nemesisId ? players.find(p => (p.riotId || p.summonerName) === nemesisId) : null;

  const teamKillsTotal = sumKills(mine);
  // Clamped: a disconnect or odd payload can otherwise report >100%.
  const myKP = teamKillsTotal
    ? Math.min(100, Math.round(((me.scores.kills + me.scores.assists) / teamKillsTotal) * 100))
    : null;

  return {
    goldDiff: Math.round(myGold - foeGold),
    teamItemGold: myGold,
    enemyItemGold: foeGold,
    enemyDamage: { ad: adCount, ap: apCount },
    myArmor: Math.round(stats.armor || 0),
    myMagicResist: Math.round(stats.magicResist || 0),
    myKP,
    // Direct lane opponent — drives the pre-game matchup briefing.
    enemyLaner: foes.find(p => p.position && p.position === me.position)?.championName || null,
    nemesis: nemesisPlayer && killsOnMe[nemesisId] >= 2
      ? { champion: nemesisPlayer.championName, times: killsOnMe[nemesisId] }
      : null,
    phase: gamePhase(gameTime),
    myTeam, enemyTeam,
    teamKills: sumKills(mine),
    enemyKills: sumKills(foes),
    myLevel: me.level || 0,
    enemyAvgLevel: Math.round(avgLevel(foes) * 10) / 10,
    dragons: { mine: objectives.dragons[myTeam], theirs: objectives.dragons[enemyTeam] },
    barons: { mine: objectives.barons[myTeam], theirs: objectives.barons[enemyTeam] },
    turrets: { mine: objectives.turrets[myTeam], theirs: objectives.turrets[enemyTeam] },
    inhibs: { mine: objectives.inhibs[myTeam], theirs: objectives.inhibs[enemyTeam] },
    soulTerrain: data.gameData?.mapTerrain || null,
    baronUpIn: Math.round(baronUpIn),
    isDead: !!me.isDead,
    respawnTimer: Math.round(me.respawnTimer || 0),
    fedEnemy: fed ? { champion: fed.championName, k: fed.scores.kills, d: fed.scores.deaths, a: fed.scores.assists } : null,
    allies: mine.map(p => ({ champion: p.championName, k: p.scores.kills, d: p.scores.deaths, a: p.scores.assists, lvl: p.level, cs: p.scores.creepScore })),
    enemies: foes.map(p => ({ champion: p.championName, k: p.scores.kills, d: p.scores.deaths, a: p.scores.assists, lvl: p.level, cs: p.scores.creepScore })),
  };
}

// Informational prompts only — max 3, gentlest first.
// Returns {level, code, params}: the server has no UI language, so the client
// renders each code through i18n (tNudge) in whatever language is selected.
export function buildNudges(me, role, gameTime, events, gold, bucket = 'mid', ctx = null) {
  const min = Math.max(gameTime / 60, 0.5);
  const bench = (BENCHMARKS[role] || BENCHMARKS.MIDDLE)[bucket];
  const phase = ctx?.phase || gamePhase(gameTime);
  const nudges = [];

  // ── highest priority: you are dead ────────────────────────────────
  // Late death timers decide games — this outranks any farming advice.
  if (ctx?.isDead && ctx.respawnTimer >= 15) {
    nudges.push({ level: 'warn', code: 'deathTimer', params: { sec: ctx.respawnTimer } });
  }

  // ── game-deciding objectives ──────────────────────────────────────
  if (ctx) {
    if (ctx.dragons.theirs === SOUL_AT - 1) {
      nudges.push({ level: 'warn', code: 'soulPointThem' });
    } else if (ctx.dragons.mine === SOUL_AT - 1) {
      nudges.push({ level: 'info', code: 'soulPointUs' });
    }
    if (ctx.inhibs.theirs > 0) nudges.push({ level: 'warn', code: 'inhibDown' });
    // If the fed enemy is also the one killing you, the nemesis line says the
    // same thing more usefully — don't spend two slots on one champion.
    const nemesisIsFed = ctx.nemesis && ctx.fedEnemy && ctx.nemesis.champion === ctx.fedEnemy.champion;
    if (ctx.nemesis && ctx.nemesis.times >= 3) {
      nudges.push({ level: 'warn', code: 'nemesis', params: { champ: ctx.nemesis.champion, n: ctx.nemesis.times } });
    }
    if (!nemesisIsFed && phase !== 'early' && ctx.fedEnemy && ctx.fedEnemy.k >= 8 && ctx.fedEnemy.k > ctx.fedEnemy.d * 2) {
      nudges.push({ level: 'warn', code: 'fedEnemy', params: { champ: ctx.fedEnemy.champion, k: ctx.fedEnemy.k, d: ctx.fedEnemy.d } });
    }
    if (phase !== 'early' && ctx.myLevel && ctx.enemyAvgLevel - ctx.myLevel >= 2) {
      nudges.push({ level: 'warn', code: 'behindLevels', params: { n: Math.round(ctx.enemyAvgLevel - ctx.myLevel) } });
    }

    // ── itemization: the highest-leverage habit most players never build ──
    // Only after the first real shopping trip, so we don't nag at level 3.
    if (phase !== 'early' && ctx.enemyDamage) {
      const { ad, ap } = ctx.enemyDamage;
      if (ad >= 3 && ad > ap && ctx.myArmor > 0 && ctx.myArmor < 80) {
        nudges.push({ level: 'warn', code: 'buyArmor', params: { n: ad, armor: ctx.myArmor } });
      } else if (ap >= 3 && ap > ad && ctx.myMagicResist > 0 && ctx.myMagicResist < 60) {
        nudges.push({ level: 'warn', code: 'buyMR', params: { n: ap, mr: ctx.myMagicResist } });
      }
    }
    if (phase !== 'early' && ctx.goldDiff <= -3000) {
      nudges.push({ level: 'warn', code: 'goldBehind', params: { k: Math.round(-ctx.goldDiff / 1000) } });
    }
  }

  // Objective soft-timers.
  const lastDragon = lastEventTime(events, 'DragonKill');
  if (lastDragon != null) {
    const next = lastDragon + DRAGON_RESPAWN - gameTime;
    if (next > 0 && next <= 45) nudges.push({ level: 'info', code: 'dragon', params: { sec: clamp(next) } });
  }
  const baronNext = ctx ? ctx.baronUpIn : null;
  if (baronNext != null && baronNext > 0 && baronNext <= 45) {
    nudges.push({ level: 'info', code: 'baron', params: { sec: clamp(baronNext) } });
  }

  // ── phase-appropriate personal play ───────────────────────────────
  // Farming/vision advice matters in lane; late game it's noise next to
  // "don't get caught", so it's gated by phase.
  const csPerMin = me.scores.creepScore / min;
  if (phase !== 'late' && gameTime > 180 && role !== 'UTILITY' && csPerMin < bench.csPerMin * 0.85) {
    nudges.push({ level: 'warn', code: 'csPace', params: { cs: csPerMin.toFixed(1), target: bench.csPerMin } });
  }
  const visPerMin = (me.scores.wardScore || 0) / min;
  if (gameTime > 480 && visPerMin < bench.visPerMin * 0.7) {
    nudges.push({ level: 'warn', code: phase === 'late' ? 'visionLate' : 'vision' });
  }
  if (me.scores.deaths >= 4) {
    nudges.push({ level: 'warn', code: 'deaths', params: { n: me.scores.deaths } });
  }
  // Unspent gold hurts more early; late you're expected to carry more.
  const goldCap = phase === 'early' ? 1400 : phase === 'mid' ? 1800 : 2600;
  if (gold >= goldCap) nudges.push({ level: 'info', code: 'gold', params: { gold } });

  if (phase === 'early' && gameTime > 150 && (me.scores.wardScore || 0) < 2) {
    nudges.push({ level: 'info', code: 'earlyWard' });
  }

  // Phase-appropriate fallback so the widget is never empty or off-topic.
  if (!nudges.length) {
    nudges.push({ level: 'info', code: phase === 'late' ? 'lateGroup' : phase === 'mid' ? 'midFocus' : 'earlyFocus' });
  }

  return nudges.slice(0, 3);
}

// Shape the raw allgamedata into what the widget needs.
export async function buildLiveResponse(data, bucket = 'mid') {
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
  const ctx = await gameContext(data, { ...me, level: data.activePlayer?.level || me.level || 0 });

  return {
    inGame: true,
    ready: true,
    gameTimeSec: Math.round(gameTime),
    phase: ctx.phase,
    ctx,
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
    nudges: buildNudges(me, role, gameTime, events, gold, bucket, ctx),
  };
}

// LLM-backed single live recommendation (polled less often than the widget).
export async function liveCoachResponse(bucket = 'mid', lang = 'en') {
  const data = await fetchLiveData();
  const base = await buildLiveResponse(data, bucket);
  if (!base.ready) return { inGame: base.inGame !== false, ready: false };
  const { tip, code, params, source } = await liveTip({
    me: base.me,
    gameTimeSec: base.gameTimeSec,
    role: base.me.role,
    nudges: base.nudges,
    ctx: base.ctx,
    lang,
  });
  // tip = LLM prose (already in `lang`); code/params = template the client localizes.
  return { inGame: true, ready: true, tip, code, params, source };
}
