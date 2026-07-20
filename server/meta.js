import * as cache from './cache.js';
import { currentPatch } from './news.js';
import { groundedAnswer } from './llm.js';

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
    'every patch, so prefer fresh sources over memory. Output EXACTLY this structure, no preamble:\n' +
    '1) Start + core items (one line)\n' +
    '2) Three matchup rules — each actionable (threat → what to do), one line each\n' +
    '3) Your power spike and what to do when it hits (one line)\n' +
    'Max 90 words total.' +
    (lang !== 'en' ? ' Write the entire answer in natural, grammatically correct ' +
      ({ uk: 'Ukrainian', fr: 'French', de: 'German', es: 'Spanish', pl: 'Polish', pt: 'Brazilian Portuguese', ru: 'Russian', tr: 'Turkish', ko: 'Korean', zh: 'Simplified Chinese', ja: 'Japanese', vi: 'Vietnamese' }[lang] || 'English') + '.' : '');

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
