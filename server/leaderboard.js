import { getApexLeague, getLeaguePage, getRiotId } from './riot.js';

// Riot ranks only the three apex tiers. Those come back as a real ordered
// ladder; everything below is an unordered page of players in one division,
// so `ranked` tells the page which of the two it is looking at.
export const APEX = ['challenger', 'grandmaster', 'master'];
export const TIERS = [...APEX, 'diamond', 'emerald', 'platinum', 'gold', 'silver', 'bronze', 'iron'];
export const DIVISIONS = ['I', 'II', 'III', 'IV'];
export const QUEUES = { solo: 'RANKED_SOLO_5x5', flex: 'RANKED_FLEX_SR' };

const TOP_N = 50;
const NAME_CONCURRENCY = 6; // the ladder gives puuids; names are one call each

// Resolve names a few at a time. Sequentially this took ~20s on a cold cache;
// unbounded it trips Riot's per-second limit and every request starts backing
// off, which is slower still.
async function withNames(rows, platform) {
  const out = [];
  for (let i = 0; i < rows.length; i += NAME_CONCURRENCY) {
    const chunk = rows.slice(i, i + NAME_CONCURRENCY);
    out.push(...await Promise.all(chunk.map(async row => {
      if (!row.puuid) return row;
      // A single unresolved name must not empty the whole ladder, so the row
      // is kept and the page falls back to showing the rank without a name.
      try {
        const acct = await getRiotId(row.puuid, platform);
        return { ...row, name: acct.gameName, tag: acct.tagLine };
      } catch {
        return row;
      }
    })));
  }
  return out;
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

  return {
    platform, tier, queue: queueKey,
    division: isApex ? null : division,
    ranked: isApex, // false = a sample of the division, not places 1..50
    players: await withNames(entries, platform),
  };
}
