// Prove the data pipeline before any UI (spec §10.2):
//   npm run probe -- "Faker#KR1" kr
// Prints the last 20 ranked games' key stats + aggregate metrics + gaps.
// No LLM, no server — just the Riot pipeline and the engine.
import { getAccount, getRank, getMatchIds, getMatches, extractParticipant } from '../server/riot.js';
import { aggregate, rankGaps, tierBucket, mainRole } from '../server/engine.js';
import { config } from '../server/config.js';

const [, , riotId, platform = 'euw1'] = process.argv;

if (!riotId || !riotId.includes('#')) {
  console.error('Usage: npm run probe -- "Name#TAG" <platform>   e.g. "Faker#KR1" kr');
  process.exit(1);
}
if (!config.riotKey) {
  console.error('RIOT_API_KEY is not set. Copy .env.example → .env and add your key.');
  process.exit(1);
}

const [gameName, tagLine] = riotId.split('#');

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 1) => Number(v).toFixed(n);

(async () => {
  console.log(`\nResolving ${gameName}#${tagLine} on ${platform}...`);
  const account = await getAccount(gameName, tagLine, platform);
  const rank = await getRank(account.puuid, platform);
  console.log(`puuid: ${account.puuid.slice(0, 12)}…   rank: ${rank ? `${rank.tier} ${rank.rank} ${rank.lp}LP` : 'unranked'}`);

  const { ids, queueScope } = await getMatchIds(account.puuid, platform, 20);
  console.log(`Reading ${ids.length} matches (${queueScope})...\n`);

  const matches = await getMatches(ids, platform, (i, n) => process.stdout.write(`\r  fetched ${i}/${n}`));
  process.stdout.write('\r');
  const games = matches.map(m => extractParticipant(m, account.puuid, { gameName, tagLine })).filter(Boolean);

  console.log(pad('CHAMP', 14) + pad('ROLE', 9) + pad('W/L', 4) + pad('KDA', 12) + pad('CS/m', 7) + pad('Vis/m', 7) + pad('KP', 6) + 'Dur');
  for (const g of games) {
    console.log(
      pad(g.champion, 14) + pad(g.role, 9) + pad(g.win ? 'W' : 'L', 4) +
      pad(`${g.kills}/${g.deaths}/${g.assists}`, 12) +
      pad(num(g.csPerMin), 7) + pad(num(g.visPerMin, 2), 7) +
      pad(Math.round(g.kp * 100) + '%', 6) + `${Math.round(g.durationSec / 60)}m` + (g.remake ? ' (remake)' : '')
    );
  }

  const { role } = mainRole(games);
  const bucket = tierBucket(rank?.tier);
  const metrics = aggregate(games);
  const gaps = rankGaps(metrics, role, bucket);

  console.log(`\nMain role: ${role}   bucket: ${bucket}   games used: ${metrics._gamesUsed}`);
  console.log('\nAggregate vs benchmark (worst gaps first):');
  for (const g of gaps) {
    const pct = Math.round(g.gap * 100);
    console.log(`  ${pad(g.label, 22)} you ${pad(num(g.player, 2), 8)} target ${pad(num(g.target, 2), 8)} gap ${pct > 0 ? '+' : ''}${pct}%`);
  }
  console.log('\nTop 3 personal weaknesses:', gaps.slice(0, 3).map(g => g.label).join(', '), '\n');
})().catch(e => {
  console.error('\nProbe failed:', e.message);
  process.exit(1);
});
