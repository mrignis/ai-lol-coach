import { config } from './config.js';
import * as cache from './cache.js';

// "News" without scraping: official, reliable sources only.
//  - current patch version   → Data Dragon (public, no key)
//  - this week's free rotation → Riot CHAMPION-V3 (needs key; degrades gracefully)
// Cached ~1h so we don't hammer either source.
const TTL = 60 * 60 * 1000;

async function currentPatch() {
  const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
  return versions[0];
}

async function championByKey(patch) {
  const data = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`)).json();
  const byKey = {};
  // id is the image filename (e.g. "MonkeyKing"); name is the display name.
  for (const id in data.data) byKey[data.data[id].key] = { id, name: data.data[id].name };
  return byKey;
}

export async function getNews(platform) {
  const key = `news_${platform}`;
  const hit = await cache.get(key);
  if (hit && Date.now() - (hit._ts || 0) < TTL) return hit;

  const patch = await currentPatch();

  let rotation = [];
  if (config.riotKey) {
    try {
      const rot = await (await fetch(
        `https://${platform}.api.riotgames.com/lol/platform/v3/champion-rotations`,
        { headers: { 'X-Riot-Token': config.riotKey } }
      )).json();
      // Riot returns `sr` (Summoner's Rift) now; older payloads used `freeChampionIds`.
      const ids = rot.sr || rot.freeChampionIds || [];
      if (Array.isArray(ids) && ids.length) {
        const champs = await championByKey(patch);
        rotation = ids.map(id => champs[String(id)]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch { /* rotation is optional — patch still shows */ }
  }

  const result = {
    patch,
    patchNotesUrl: 'https://www.leagueoflegends.com/en-us/news/game-updates/',
    newsUrl: 'https://www.leagueoflegends.com/en-us/news/',
    rotation,
    _ts: Date.now(),
  };
  await cache.set(key, result);
  return result;
}
