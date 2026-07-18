import * as cache from './cache.js';

// Champion metadata from Data Dragon (public, no key). Used to classify the
// enemy team's damage type so we can recommend the right defensive item.
// Data-driven on purpose: a hardcoded AD/AP champion list would rot every patch.
const TTL = 24 * 60 * 60 * 1000;
let memo = null;

async function currentPatch() {
  const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
  return versions[0];
}

// → { "Ahri": { magic: 8, attack: 3, tags: ["Mage","Assassin"] }, ... }
export async function getChampions() {
  if (memo && Date.now() - memo._ts < TTL) return memo.data;
  const cached = await cache.get('ddragon_champs');
  if (cached && Date.now() - (cached._ts || 0) < TTL) {
    memo = cached;
    return cached.data;
  }
  const patch = await currentPatch();
  const raw = await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`)).json();
  const data = {};
  for (const id in raw.data) {
    const c = raw.data[id];
    data[c.name] = { magic: c.info?.magic ?? 5, attack: c.info?.attack ?? 5, tags: c.tags || [] };
  }
  memo = { data, _ts: Date.now() };
  await cache.set('ddragon_champs', memo);
  return data;
}

// Is this champion primarily magic damage?
export function isAP(name, champs) {
  const c = champs?.[name];
  if (!c) return false;
  if (c.tags.includes('Marksman')) return false;          // marksmen are AD even with high magic
  if (c.tags.includes('Mage')) return true;
  return c.magic > c.attack;
}
