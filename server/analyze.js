import { getAccount, getRank, getMatchIds, getMatches, extractParticipant } from './riot.js';
import { aggregate, rankGaps, topWeaknesses, tierBucket, mainRole } from './engine.js';
import { coach } from './llm.js';

// Parse "gameName#tagLine" (tag optional-ish; default region tag hint not applied).
export function parseRiotId(raw) {
  const s = String(raw || '').trim();
  const hash = s.lastIndexOf('#');
  if (hash === -1) throw Object.assign(new Error('Riot ID must be "Name#TAG"'), { code: 400 });
  const gameName = s.slice(0, hash).trim();
  const tagLine = s.slice(hash + 1).trim();
  if (!gameName || !tagLine) throw Object.assign(new Error('Riot ID must be "Name#TAG"'), { code: 400 });
  return { gameName, tagLine };
}

// Full pipeline: Riot ID + platform → summary, weaknesses + coaching, game list.
export async function analyzePlayer(riotId, platform, { onProgress } = {}) {
  const { gameName, tagLine } = parseRiotId(riotId);

  const account = await getAccount(gameName, tagLine, platform);
  const puuid = account.puuid;

  const [rank, { ids, queueScope }] = await Promise.all([
    getRank(puuid, platform),
    getMatchIds(puuid, platform, 20),
  ]);

  if (!ids.length) {
    throw Object.assign(new Error('No recent matches found for this account'), { code: 404 });
  }

  const matches = await getMatches(ids, platform, onProgress);
  const games = matches.map(m => extractParticipant(m, puuid)).filter(Boolean);

  const played = games.filter(g => !g.remake);
  const wins = played.filter(g => g.win).length;
  const { role, gamesInRole, spread } = mainRole(games);
  const bucket = tierBucket(rank?.tier);
  const roleMixed = gamesInRole < played.length * 0.7;

  const metrics = aggregate(games);
  const gaps = rankGaps(metrics, role, bucket);
  const weaknesses = topWeaknesses(gaps, 3);

  // Top champions by games played (with per-champ win count).
  const champCounts = {};
  for (const g of played) {
    champCounts[g.champion] = champCounts[g.champion] || { champion: g.champion, games: 0, wins: 0 };
    champCounts[g.champion].games++;
    if (g.win) champCounts[g.champion].wins++;
  }
  const mainChamps = Object.values(champCounts).sort((a, b) => b.games - a.games).slice(0, 3);

  const coaching = await coach({ rank, role, bucket, roleMixed, weaknesses });

  return {
    summary: {
      gameName: account.gameName || gameName,
      tagLine: account.tagLine || tagLine,
      platform,
      rank,
      mainRole: role,
      roleMixed,
      roleSpread: spread,
      mainChamps,
      gamesAnalyzed: played.length,
      wins,
      losses: played.length - wins,
      winRate: played.length ? wins / played.length : 0,
      queueScope,
    },
    metrics: {
      csPerMin: metrics.csPerMin,
      visPerMin: metrics.visPerMin,
      kp: metrics.kp,
      deaths: metrics.deaths,
      goldPerMin: metrics.goldPerMin,
      dmgPerMin: metrics.dmgPerMin,
      consistency: metrics._consistency,
    },
    weaknesses: {
      bucket,
      role,
      gaps: weaknesses,
      coachText: coaching.text,
      coachSource: coaching.source,
    },
    games,
  };
}
