import { platformToRegional, accountRegional } from './config.js';
import { riotTarget, canRiot } from './upstream.js';
import * as cache from './cache.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

class RiotError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Single gated GET with 429 back-off and optional immutable disk cache.
// region = routing value / platform; path = everything after the host.
async function riotGet(region, path, { cacheKey } = {}) {
  if (!canRiot) throw new RiotError('No Riot access configured (set PROXY_URL or RIOT_API_KEY)', 500);
  if (cacheKey) {
    const hit = await cache.get(cacheKey);
    if (hit) return hit;
  }
  const { url, headers } = riotTarget(region, path);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || 1);
      await sleep((retry + 0.2) * 1000);
      continue;
    }
    if (res.status === 404) throw new RiotError('not_found', 404);
    if (res.status === 401 || res.status === 403) {
      throw new RiotError('Riot key rejected (expired or invalid — dev keys last 24h)', 403);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new RiotError(`riot_${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    const data = await res.json();
    if (cacheKey) await cache.set(cacheKey, data);
    return data;
  }
  throw new RiotError('rate_limited', 429);
}

// ── ACCOUNT-V1: Riot ID → puuid ───────────────────────────────────────
export async function getAccount(gameName, tagLine, platform) {
  const region = accountRegional(platform);
  const path = `riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotGet(region, path); // not cached — names can change puuid mapping rarely, keep fresh
}

// ── LEAGUE-V4: puuid → rank (solo queue preferred) ────────────────────
export async function getRank(puuid, platform) {
  let entries;
  try {
    entries = await riotGet(platform, `lol/league/v4/entries/by-puuid/${puuid}`);
  } catch (e) {
    if (e.code === 404) return null;
    throw e;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const solo = entries.find(e => e.queueType === 'RANKED_SOLO_5x5') || entries[0];
  const total = (solo.wins || 0) + (solo.losses || 0);
  return {
    queueType: solo.queueType,
    tier: solo.tier,
    rank: solo.rank,
    lp: solo.leaguePoints,
    wins: solo.wins,
    losses: solo.losses,
    seasonWinRate: total ? solo.wins / total : null,
  };
}

// ── MATCH-V5: puuid → last N ranked match IDs ─────────────────────────
export async function getMatchIds(puuid, platform, count = 20) {
  const region = platformToRegional(platform);
  const base = `lol/match/v5/matches/by-puuid/${puuid}/ids`;
  let ids = await riotGet(region, `${base}?type=ranked&start=0&count=${count}`);
  let queueScope = 'ranked';
  if (!ids || ids.length === 0) {
    // New / unranked account: fall back to any queue so the player still gets a read.
    ids = await riotGet(region, `${base}?start=0&count=${count}`);
    queueScope = 'any';
  }
  return { ids: ids || [], queueScope };
}

// ── MATCH-V5: matchId → full match (cached, immutable) ────────────────
export async function getMatch(matchId, platform) {
  const region = platformToRegional(platform);
  return riotGet(region, `lol/match/v5/matches/${matchId}`, { cacheKey: `match_${matchId}` });
}

// Fetch matches with light throttling to stay well under dev rate limits.
// Cached matches return instantly; only new ones hit the network.
export async function getMatches(ids, platform, onProgress) {
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    try {
      out.push(await getMatch(ids[i], platform));
    } catch (e) {
      if (e.code === 404) continue; // occasionally a match id 404s; skip it
      throw e;
    }
    if (onProgress) onProgress(i + 1, ids.length);
    await sleep(70); // ~14 req/s ceiling, safely below 20/s
  }
  return out;
}

// Pull out just this player's stats from a full match object.
// Match by puuid first; fall back to Riot ID (gameName#tagLine) because
// Match-V5 puuids are scoped to the API key that fetched the data — a match
// cached under an old/rotated key won't match the current account puuid, but
// riotIdGameName/riotIdTagline stay stable. This keeps cached games usable
// across daily dev-key rotation.
export function extractParticipant(match, puuid, riotId = null) {
  const info = match.info;
  let p = info.participants.find(x => x.puuid === puuid);
  if (!p && riotId && riotId.gameName) {
    const g = riotId.gameName.toLowerCase();
    const t = (riotId.tagLine || '').toLowerCase();
    p = info.participants.find(x =>
      (x.riotIdGameName || '').toLowerCase() === g &&
      (!t || (x.riotIdTagline || '').toLowerCase() === t));
  }
  if (!p) return null;

  // gameDuration is seconds when gameEndTimestamp exists, else milliseconds (legacy).
  const durSec = info.gameEndTimestamp ? info.gameDuration : info.gameDuration / 1000;
  const min = Math.max(durSec / 60, 1);
  const ch = p.challenges || {};
  const teamKills = info.participants
    .filter(x => x.teamId === p.teamId)
    .reduce((a, x) => a + x.kills, 0);
  const cs = (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
  const kp = ch.killParticipation != null
    ? ch.killParticipation
    : (teamKills ? (p.kills + p.assists) / teamKills : 0);

  return {
    matchId: match.metadata.matchId,
    champion: p.championName,
    role: p.teamPosition || p.individualPosition || 'UNKNOWN',
    win: p.win,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs,
    csPerMin: cs / min,
    visionScore: p.visionScore || 0,
    visPerMin: (p.visionScore || 0) / min,
    kp,
    goldPerMin: (p.goldEarned || 0) / min,
    dmgPerMin: (p.totalDamageDealtToChampions || 0) / min,
    objectives: (p.turretTakedowns || 0) + (ch.dragonTakedowns || 0) + (ch.baronTakedowns || 0),
    durationSec: Math.round(durSec),
    queueId: info.queueId,
    remake: durSec < 300, // remakes/early-FF skew per-game stats
  };
}
