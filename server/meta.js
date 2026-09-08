import * as cache from './cache.js';
import { currentPatch } from './news.js';
import { groundedAnswer, languageRule } from './llm.js';

// Pre-game matchup briefing: the bot "reads the guides" for the player.
// Google-search-grounded so it reflects the CURRENT patch, then cached per
// (patch, champ, enemy, role, lang) — one web lookup per matchup per patch.
const safe = s => String(s || '').replace(/[^a-zA-Z0-9]/g, '');

export async function matchupBrief({ champ, vs, role, lang = 'en' }) {
  const patch = await currentPatch();
  const key = `matchup_${patch}_${safe(champ)}_${safe(vs) || 'none'}_${safe(role)}_${lang}`;
  const hit = await cache.get(key);
  if (hit && hit.brief) return hit;

  const system =
    'You are a League of Legends coach preparing a player right before a ranked game. ' +
    'Use web search to find guidance for the CURRENT patch — builds and matchup advice change ' +
    'every patch, so prefer fresh sources over memory. The brief is opened once and stays on screen ' +
    'for the WHOLE game, so it must still be useful at 30 minutes — not only in lane. Output EXACTLY ' +
    'this structure, no preamble:\n' +
    '1) Start + core items, and the one item to add if the enemy team is mostly AD or mostly AP (one line)\n' +
    '2) LANE (to ~level 6): two rules against this specific opponent — threat → what to do\n' +
    '3) MID GAME (after your first item): where you go and what you do once lane is over — grouping, ' +
    'roaming, which objective your champion enables (one line)\n' +
    '4) LATE GAME: your win condition and what loses the game for you — how you position in a 5v5 and ' +
    'what you must never be caught doing (one line)\n' +
    'Max 130 words total.' +
    // Same plain-text + no-half-translation rules as the coaching prompts: this
    // brief is rendered with textContent, so Markdown would show up literally.
    '\n\nFORMAT — plain text only. No Markdown of any kind: no asterisks (* or **), no underscores, ' +
    'no #, no backticks, no bold, no headings, no bullet characters. Never write the same word twice ' +
    'in a row and never leave a sentence unfinished.' +
    languageRule(lang);

  const user =
    `League of Legends patch ${patch}. I am about to play ${champ} (${role})` +
    (vs ? ` against ${vs}` : '') +
    ` in ranked. What is the current recommended build and matchup plan?`;

  const r = await groundedAnswer({ system, user });
  const out = { patch, champ, vs: vs || null, brief: r.text, source: r.source, _ts: Date.now() };
  // Only cache web-grounded answers: the no-search fallback can carry stale
  // builds, and caching it would pin wrong items for the whole patch.
  if (r.text && r.source === 'gemini-search') await cache.set(key, out);
  return out;
}

// Strongest picks on the current patch, by role.
//
// There is no Riot endpoint for this — pick rates and win rates are computed by
// third parties from match samples, not published. So it comes from the same
// web-grounded lookup as the matchup brief, which reads live guide sites, and
// is cached per patch: one search a patch, not one per visit.
//
// Champion names must come back exactly as Data Dragon spells them, because the
// UI links each one straight into the build lookup.
export async function metaPicks({ lang = 'en' } = {}) {
  const patch = await currentPatch();
  const key = `metapicks_${patch}_${lang}`;
  const hit = await cache.get(key);
  if (hit && hit.roles?.length) return hit;

  const system =
    'You are reporting the current League of Legends solo-queue meta. Use web search — pick and win ' +
    'rates change every patch, so prefer fresh sources over memory. For EACH of the five roles name ' +
    'the three strongest picks right now.\n' +
    'Output one line per role and nothing else, in exactly this shape:\n' +
    'TOP: Name, Name, Name\n' +
    'JUNGLE: Name, Name, Name\n' +
    'MIDDLE: Name, Name, Name\n' +
    'BOTTOM: Name, Name, Name\n' +
    'UTILITY: Name, Name, Name\n' +
    'Champion names EXACTLY as the game client spells them, in English, with the same punctuation ' +
    "(Kai'Sa, Kha'Zix, Nunu & Willump). No commentary, no numbers, no markdown.";

  const r = await groundedAnswer({
    system,
    user: `League of Legends patch ${patch}. Which champions are strongest in solo queue right now, by role?`,
  });
  if (!r.text) return { patch, roles: [], source: r.source };

  // Parse into structure rather than shipping a paragraph: the client renders
  // each champion as a link into the build page.
  const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const roles = [];
  for (const line of r.text.split('\n')) {
    const m = line.match(/^\s*(TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY)\s*:\s*(.+)$/i);
    if (!m) continue;
    const role = m[1].toUpperCase();
    const champs = m[2].split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (champs.length) roles.push({ role, champions: champs });
  }
  roles.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));

  const out = { patch, roles, source: r.source, _ts: Date.now() };
  // Only cache a web-grounded answer. Without search the model reports the meta
  // of whenever it was trained, which would then be pinned for the whole patch.
  if (roles.length === 5 && r.source === 'gemini-search') await cache.set(key, out);
  return out;
}
