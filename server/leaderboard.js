import { getApexLeague, getLeaguePage, getRiotId } from './riot.js';
import * as cache from './cache.js';

// Riot ranks only the three apex tiers. Those come back as a real ordered
// ladder; everything below is an unordered page of players in one division,
// so `ranked` tells the page which of the two it is looking at.
export const APEX = ['challenger', 'grandmaster', 'master'];
export const TIERS = [...APEX, 'diamond', 'emerald', 'platinum', 'gold', 'silver', 'bronze', 'iron'];
export const DIVISIONS = ['I', 'II', 'III', 'IV'];
export const QUEUES = { solo: 'RANKED_SOLO_5x5', flex: 'RANKED_FLEX_SR' };

const TOP_N = 50;
const NAME_TTL = 7 * 24 * 3600 * 1000;

// The ladder returns puuids, and a name is one Riot call each. Fifty of those
// per page view does not fit the key's budget of 100 requests per two minutes:
// resolving them inline made a single lookup take 47 SECONDS once the key was
// in back-off, and the whole page waited on it.
//
// So the request never blocks on a name. It returns whatever is already
// cached, and the rest are filled in by a background queue at a pace the key
// can sustain; the client asks again and the names appear. Only the ladder
// currently on screen is worth resolving, so a new request REPLACES the queue
// rather than appending to it — switching regions must not leave the previous
// region's fifty names ahead of yours.
const NAME_PACE_MS = 250; // ~4 req/s, comfortably inside every Riot limit
let queue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const { puuid, platform } = queue.shift();
    try {
      await getRiotId(puuid, platform); // populates the cache; result unused here
    } catch { /* a name that will not resolve is not worth retrying in a loop */ }
    await new Promise(r => setTimeout(r, NAME_PACE_MS));
  }
  draining = false;
}

async function attachCachedNames(rows, platform) {
  const missing = [];
  const out = await Promise.all(rows.map(async row => {
    if (!row.puuid) return row;
    const hit = await cache.get(`name_${row.puuid}`, NAME_TTL);
    if (hit) return { ...row, name: hit.gameName, tag: hit.tagLine };
    missing.push({ puuid: row.puuid, platform });
    return row;
  }));
  queue = missing;
  if (missing.length) drain();
  return { players: out, pending: missing.length };
}

export async function leaderboard(platform, tier, queueKey, division = 'I') {
  const queue = QUEUES[queueKey];
  const isApex = APEX.includes(tier);
  // Apex: one league object with every player in it. Below that: a page of
  // entries for one division, which is all Riot will give.
  const raw = isApex
    ? (await getApexLeague(platform, tier, queue))?.entries
    : await getLeaguePage(platform, queue, tier.toUpperCase(), division);

  const entries = (raw || [])
    .sort((a, b) => b.leaguePoints - a.leaguePoints)
    .slice(0, TOP_N)
    .map((e, i) => {
      const games = (e.wins || 0) + (e.losses || 0);
      return {
        place: i + 1,
        puuid: e.puuid || null,
        lp: e.leaguePoints || 0,
        wins: e.wins || 0,
        losses: e.losses || 0,
        winRate: games ? Math.round((e.wins / games) * 100) : null,
        hotStreak: !!e.hotStreak,
      };
    });

  const { players, pending } = await attachCachedNames(entries, platform);
  return {
    platform, tier, queue: queueKey,
    division: isApex ? null : division,
    ranked: isApex, // false = a sample of the division, not places 1..50
    pending,        // names still resolving; the client re-asks while > 0
    players,
  };
}
