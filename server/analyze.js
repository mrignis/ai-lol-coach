import { getAccount, getRank, getMatchIds, getMatches, extractParticipant } from './riot.js';
import { aggregate, aggregateByRole, roleBreakdown, rankGaps, topWeaknesses, tierBucket, mainRole,
         MIN_GAMES_FOR_CONFIDENCE } from './engine.js';
import { coach } from './llm.js';
import { loadAnalyses, appendAnalysis, computeTrends, METRICS_BASIS } from './history.js';

// Parse "gameName#tagLine" (tag optional-ish; default region tag hint not applied).
// Zero-width and bidi control characters ride along when a Riot ID is copied
// from a browser, Discord or a chat app. They are invisible in the input box
// but make the account lookup 404 — verified: the same name returns 200 clean
// and 404 wrapped in U+2066/U+2069.
const INVISIBLE = /[­​-‏‪-‮⁠-⁯﻿]/g;

function parseRiotId(raw) {
  const s = String(raw || '').replace(INVISIBLE, '').trim();
  const hash = s.lastIndexOf('#');
  if (hash === -1) throw Object.assign(new Error('Riot ID must be "Name#TAG"'), { code: 400 });
  const gameName = s.slice(0, hash).trim();
  const tagLine = s.slice(hash + 1).trim();
  if (!gameName || !tagLine) throw Object.assign(new Error('Riot ID must be "Name#TAG"'), { code: 400 });
  return { gameName, tagLine };
}

// Full pipeline: Riot ID + platform → summary, weaknesses + coaching, game list.
export async function analyzePlayer(riotId, platform, { onProgress, lang } = {}) {
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
  const identity = { gameName: account.gameName || gameName, tagLine: account.tagLine || tagLine };
  const games = matches.map(m => extractParticipant(m, puuid, identity)).filter(Boolean);

  const played = games.filter(g => !g.remake);
  const wins = played.filter(g => g.win).length;
  const { role, gamesInRole, spread } = mainRole(games);
  const bucket = tierBucket(rank?.tier);
  const roleMixed = gamesInRole < played.length * 0.7;

  // Each role is averaged on its own. Blending them and then judging the result
  // against a single role's benchmarks made a 17-support account read as farming
  // 29% above a support's target — the two off-role games it also counted were a
  // jungle and a bottom lane.
  //
  // EVERY role gets its own reading, not just the main one — dropping the other
  // roles would silently discard whole sessions from a player who flexes. The
  // numbers and gaps are computed locally, so covering all of them is free; only
  // the written coaching costs an LLM call, and that stays on the main role.
  const breakdown = roleBreakdown(games);
  const roles = breakdown.map(({ role: r, games: n }) => {
    const m = aggregateByRole(games, r);
    return {
      role: r,
      games: n,
      // Below this, one bad game moves the average too far to call it a weakness.
      confident: n >= MIN_GAMES_FOR_CONFIDENCE,
      metrics: {
        csPerMin: m.csPerMin, visPerMin: m.visPerMin, kp: m.kp,
        deaths: m.deaths, goldPerMin: m.goldPerMin, dmgPerMin: m.dmgPerMin,
        consistency: m._consistency,
      },
      gaps: topWeaknesses(rankGaps(m, r, bucket), 3),
    };
  });

  const roleGames = played.filter(g => g.role === role);
  const metrics = aggregateByRole(games, role);
  const gaps = rankGaps(metrics, role, bucket);
  const weaknesses = topWeaknesses(gaps, 3);
  // How much the main-role reading is worth. Below the threshold the coach is
  // told to say the sample is thin instead of stating a weakness as fact.
  const roleSample = {
    role,
    games: roleGames.length,
    ofTotal: played.length,
    confident: roleGames.length >= MIN_GAMES_FOR_CONFIDENCE,
    breakdown,
  };

  // Top champions by games played (with per-champ win count).
  const champCounts = {};
  for (const g of played) {
    champCounts[g.champion] = champCounts[g.champion] || { champion: g.champion, games: 0, wins: 0 };
    champCounts[g.champion].games++;
    if (g.win) champCounts[g.champion].wins++;
  }
  const mainChamps = Object.values(champCounts).sort((a, b) => b.games - a.games).slice(0, 3);

  // Progress memory: trends vs the player's own previous sessions.
  const playerId = `${platform}_${(account.gameName || gameName)}#${(account.tagLine || tagLine)}`;
  const metricsPlain = {
    csPerMin: metrics.csPerMin, visPerMin: metrics.visPerMin, kp: metrics.kp,
    deaths: metrics.deaths, goldPerMin: metrics.goldPerMin, dmgPerMin: metrics.dmgPerMin,
  };
  const history = await loadAnalyses(playerId);
  const progress = computeTrends(history, metricsPlain);

  const coaching = await coach({ rank, role, bucket, roleMixed, weaknesses, lang, progress, roleSample });

  await appendAnalysis(playerId, {
    date: new Date().toISOString(),
    rank: rank ? `${rank.tier} ${rank.rank}` : null,
    winRate: played.length ? wins / played.length : 0,
    mainRole: role,
    // How these numbers were measured. Trends only compare like with like.
    basis: METRICS_BASIS,
    roleGames: roleGames.length,
    metrics: metricsPlain,
    weaknesses: weaknesses.map(w => w.key),
  });

  return {
    summary: {
      gameName: account.gameName || gameName,
      tagLine: account.tagLine || tagLine,
      platform,
      rank,
      mainRole: role,
      roleMixed,
      roleSpread: spread,
      roleSample,
      roles,
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
    progress,
    games,
  };
}
