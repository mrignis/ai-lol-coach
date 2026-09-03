import { config } from './config.js';
import { METRICS, BENCHMARKS } from './benchmarks.js';
import { groqTarget, geminiTarget, openaiTarget, canGroq, canGemini, canOpenAI } from './upstream.js';

const fmt = (key, v) => (METRICS[key] ? METRICS[key].fmt(v) : String(v));

// Last line of defence for the FORMAT_RULE below. The prompt asks for plain
// text, but every provider slips a "**bold**" in eventually and the UI prints
// it verbatim, so strip the markers (never the words) on the way out.
function plainText(s) {
  return String(s)
    .replace(/```[a-z]*\n?|`/gi, '')            // code fences and inline ticks
    // *italic* / **bold**, and __underline__ — single "_" is left alone so an
    // identifier or a name never gets mangled.
    .replace(/(\*{1,3}|_{2,3})(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')       // ATX headings
    .replace(/^[ \t]*[*+•][ \t]+/gm, '- ')      // markdown bullets → plain dash
    .replace(/[*_]{2,}/g, '')                   // leftover unpaired runs
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// Plain-English meaning of each metric. A bare label was being misread once
// translated — "Deaths per game" came back as "you kill 7.7 per game" in
// Ukrainian, and "Vision score / min" turned into an invented abstract noun.
// Saying what the number actually counts removes the guesswork.
const METRIC_MEANING = {
  csPerMin: 'minions and jungle camps killed per minute',
  visPerMin: 'vision score earned per minute (wards placed plus enemy wards cleared)',
  kp: "share of the team's kills this player took part in",
  deaths: 'how many times THIS PLAYER DIES in one game (their own deaths — not kills they get)',
  goldPerMin: 'gold earned per minute',
  dmgPerMin: 'damage dealt to enemy champions per minute',
};

// Turn a gap into a one-line "your number vs target" fact for the prompt.
function gapLine(g) {
  const pct = Math.round(Math.abs(g.gap) * 100);
  const side = g.gap > 0
    ? (g.dir === 'higher' ? `${pct}% below target` : `${pct}% above target`)
    : 'at or above target';
  const meaning = METRIC_MEANING[g.key] ? ` (this metric = ${METRIC_MEANING[g.key]})` : '';
  return `- ${g.label}${meaning}: you average ${fmt(g.key, g.player)} vs a target of ${fmt(g.key, g.target)} (${side})`;
}

// lang code → language the LLM should reply in.
const LANG_NAMES = {
  en: 'English', uk: 'Ukrainian', fr: 'French', de: 'German', es: 'Spanish',
  pl: 'Polish', pt: 'Brazilian Portuguese', ru: 'Russian', tr: 'Turkish',
  ko: 'Korean', zh: 'Simplified Chinese', ja: 'Japanese', vi: 'Vietnamese',
};

// Every surface renders model output as PLAIN TEXT (textContent / escaped
// innerHTML), so any Markdown the model emits is shown literally — the UI was
// printing "**Участь у вбивствах**" asterisks and all.
const FORMAT_RULE =
  '\n\nFORMAT — plain text only. No Markdown of any kind: no asterisks (* or **), no underscores, ' +
  'no #, no backticks, no bold, no italics, no headings, no bullet characters. Numbered points are ' +
  'written as "1. ", "2. ", "3. " and nothing else. Never write the same word twice in a row, never ' +
  'leave a sentence unfinished, and re-read every sentence before you output it: each one must be ' +
  'complete, grammatical and actually mean something — never pad with a word you are unsure of.';

// Per-language glossary, kept in sync with public/i18n.js so the AI prose and
// the static UI call the same thing by the same name. Without it the model
// keeps minting transliterations ("візій", "джунг", "спавн") that no player
// says. Only languages we have verified terminology for belong here.
const LANG_TERMS = {
  uk: [
    'vision / vision score = огляд (NOT "візія", NOT "бачення"; uncountable — "огляду за хвилину", never "оглядів")',
    // Verbs are listed with the imperative the tip should actually use — given
    // only the dictionary form the model opened tips with "Ставити…".
    'ward = вард / варди; control ward = контрольний вард; to ward → command form "Постав вард" ' +
      '(never "Ставити"); sweep = чистити ворожі варди → "Почисти"',
    'lane = лінія; mid = мід; top = топ; wave = хвиля; minion = міньйон; to push = пушити',
    'jungle = ліс (NOT "джунгл"); jungler = лісник; camp = кемп; full clear = повний зачист лісу',
    'objective = об’єкт; spawn / respawn = поява / відродження (NOT "спавн"); pit = яма',
    'kill participation = участь у вбивствах; deaths per game = смертей за гру',
    'gold per minute = золота за хвилину; damage per minute = шкоди за хвилину; CS per minute = КС за хвилину',
    'trade = розмін; last-hit = добивати; back / recall = повернення на базу; roam = роум, роумити',
    'gank = ганк, ганкати; crowd control = контроль; cooldown = кулдаун; peel = прикривати',
    'shield = щит; heal = лікування; carry = керрі; front line = передня лінія; positioning = позиціювання',
    'ADC / bot carry = АДК (in Cyrillic, never "ADC"); support = сапорт; ultimate = ульта; dash = ривок',
    'inhibitor = інгібітор (NOT "інхібітор", NOT "інхіботор"); super minions = суперміньйони',
    'Baron buff = баф барона (NOT "баронський баф"); turret / tower = вежа; base = база; river = річка',
    // Actual garbage this model has produced. Naming the exact mistake works
    // better than restating the rule it already broke.
    'NEVER write any of these, they are not Ukrainian words or are plain wrong: ' +
      '"воронка"/"воронок" (invented, vision is огляд) · "позивний" (meaningless here) · ' +
      '"ADC", "ADC-й" (write АДК) · "vs" (write "проти" or use a dash) · "спавн" (write поява) · ' +
      '"dmg", "gold", "CS per min", "GPM", "DPM" (write the stat out: шкоди за хвилину, ' +
      'золота за хвилину, КС за хвилину) · "візія"/"візій" (write огляд)',
    'Never glue an English word to a Ukrainian ending with a hyphen. Every noun must agree with ' +
      'its adjective in gender and number ("захисне вміння", never "захисний уміння").',
    // One 55-minute game spelled the same ally "Kai\'Sa", "Кай’Sa" and "Кай’Са".
    'Champion names: copy them EXACTLY as the client spells them, in Latin letters, every time — ' +
      'Kai\'Sa, Kha\'Zix, Nunu & Willump. Never transliterate a champion name into Cyrillic and ' +
      'never mix alphabets inside one name.',
    'Fighting someone is "проти <Champion>" or "з <Champion>" — never "у <Champion>". ' +
      'Contesting an objective is "не борись за баф" / "не контестуй барона" — "оскаржувати" is a ' +
      'legal term and is wrong here.',
  ].map(s => '  ' + s).join('\n'),
};

// Half-translated coaching text is the single most common complaint: Ukrainian
// sentences came back stuffed with "vision score", "carries", "GPM", invented
// hybrids like "utility-здібності", and formal register the rest of the UI
// never uses. Spelling the rule out per-language is what actually stops it.
// Live tips are ~40 words but were carrying the full 1.1k-token rule on every
// call, and Groq's free tier caps TOKENS per minute (8000) rather than calls.
// Trimming the rule for the live path roughly halves the cost of a tip, which
// is the difference between ~3 and ~6 tips a minute before the cap bites.
function shortLanguageRule(lang) {
  const langName = LANG_NAMES[lang];
  if (!lang || lang === 'en' || !langName) return '';
  return `\n\nLANGUAGE — write in natural ${langName}, informal singular, imperative ` +
    '("Постав вард", never "Ставити вард"). Only champion, item and spell names stay in English. ' +
    'No English words or abbreviations otherwise, no transliterated English, no invented words.' +
    (LANG_TERMS[lang] ? `\nTerms:\n${LANG_TERMS[lang]}` : '');
}

export function languageRule(lang) {
  const langName = LANG_NAMES[lang];
  if (!lang || lang === 'en' || !langName) return '';
  return `\n\nLANGUAGE — write EVERY sentence in ${langName}, the way a ${langName}-speaking player ` +
    'actually talks about the game. Address the player informally, in the singular, and keep that same ' +
    'register for the whole reply.\n' +
    '- Every instruction is a direct command to the player: use the imperative, second person singular. ' +
    'Never phrase an instruction as an infinitive, a passive, or a description of what one ought to do. ' +
    'Required shape: "Stay behind your ADC and place a ward at the river entrance before the objective ' +
    'spawns." NOT "to stay behind the ADC and to place a ward", NOT "one should stay behind the ADC".\n' +
    '- Only proper nouns stay in English, spelled exactly as in the game client: champion names, item ' +
    "names, summoner spell names, rune names (Zhonya's Hourglass, Redemption, Flash, Grasp of the Undying).\n" +
    `- EVERY other word must be ${langName}, including game concepts: vision, ward, lane, wave, minion, ` +
    'camp, objective, trade, roam, peel, poke, shield, heal, carry, cooldown, kill participation, gold ' +
    `per minute, damage per minute. A loanword ${langName} players genuinely use is fine; an English ` +
    `word or phrase dropped into a ${langName} sentence is not, and never glue an English word onto a ` +
    `${langName} one with a hyphen.\n` +
    '- Never use the abbreviations GPM, DPM, KP, CSPM, WPM or VS — write the stat out in words.\n' +
    `- The stat labels in the data below are English: re-express each one as a ${langName} player would ` +
    'say it (an average per game, a rate per minute). Do not translate them word for word and never turn ' +
    'them into an abstract noun.\n' +
    '- Do NOT transliterate an English word into the local alphabet to invent a term — a respelled ' +
    'English word is still English. Do not clip or abbreviate words either; write them in full.\n' +
    `- Do not invent words. If you are unsure of the ${langName} term, use plain everyday wording any ` +
    'player understands.' +
    (LANG_TERMS[lang] ? `\n- Use exactly these ${langName} terms, which is what the app's own interface ` +
      `uses:\n${LANG_TERMS[lang]}` : '');
}

function buildPrompt({ rank, role, bucket, roleMixed, weaknesses, lang, progress }) {
  const system =
    'You are a friendly, direct League of Legends coach. You know THIS player from their ' +
    'own recent games — never give generic tier-list advice. No filler. Speak to them directly ("you").\n' +

    // The old version capped the whole reply at 150 words across three points,
    // which left room for the instruction and nothing else — the advice came
    // out as "ask yourself what kills you before each move", true of every
    // player at every rank. The depth below is the entire point of the report.
    // Section names are structure for you, never text for the player: an
    // earlier version printed "READ" and "KEEP" as literal English headings in
    // the middle of a Ukrainian report.
    'Write it in this order, with a blank line between sections. Do NOT print any section heading, ' +
    'label or title — the player sees only the prose:\n' +
    'First paragraph: two sentences on what kind of player their numbers describe. Not a summary of ' +
    'the list below: the pattern connecting the numbers. Two stats that explain each other are worth ' +
    'more than either alone.\n' +
    'Then exactly 3 numbered fixes, most damaging first. Each one covers, in flowing prose and in ' +
    'this order:\n' +
    '  a) what the number actually costs them, in gold, tempo or map control — not the number restated;\n' +
    '  b) WHY it is happening for a player in their role at their rank. This is the part that makes it ' +
    'coaching: name the concrete situation that produces it (the recall they take at the wrong time, ' +
    'the fight they join with the wave pushing towards the enemy, the ward they place after the ' +
    'objective already spawned);\n' +
    '  c) the change itself, specific enough to do without thinking — a timing, a trigger, a rule with ' +
    'a number in it;\n' +
    '  d) how they will know next game whether it worked, in one short clause.\n' +
    'Last paragraph: one sentence on the thing they already do well, so they do not trade it away ' +
    'chasing the fixes. It must not contradict the fixes above — do not praise a habit and then tell ' +
    'them to drop it.\n' +
    'Around 350 words, hard limit 420. Never leave a sentence unfinished.' +
    FORMAT_RULE + languageRule(lang);

  const rankStr = rank ? `${rank.tier} ${rank.rank} (${bucket}-elo benchmarks)` : `unranked (${bucket}-elo benchmarks)`;
  const mixNote = roleMixed
    ? '\nNote: they play multiple roles, so numbers are blended across roles — acknowledge this if relevant.'
    : '';

  // Trends vs their own previous sessions — the coach should react to them
  // (praise real improvement once, focus the fixes on what is NOT moving).
  let progressNote = '';
  if (progress && progress.length) {
    const fmtT = t => `${t.key}: ${t.from.toFixed(2)} → ${t.to.toFixed(2)} (${t.better ? 'improving' : 'getting worse'})`;
    progressNote =
      // Folded into the opening paragraph rather than bolted on before it: as a
      // separate instruction it produced a stray congratulation above the read,
      // which then contradicted the closing line.
      '\nProgress vs their recent sessions:\n' + progress.map(fmtT).join('\n') +
      '\nWork the biggest improvement into the opening paragraph itself, not as a separate line above ' +
      'it, and aim the 3 fixes at what is stagnant or getting worse.';
  }

  const user =
    `This player is ${rankStr}, playing mostly ${role}.\n` +
    (ROLE_BRIEF[role] ? ROLE_BRIEF[role] + '\n' : '') +
    `Their 3 biggest personal weaknesses vs players at their level:\n` +
    weaknesses.map(gapLine).join('\n') + mixNote + progressNote +
    `\n\nWrite their report now: the read, the 3 fixes, and what to keep.`;

  return { system, user };
}

// Deterministic fallback so the app is never blank if no LLM is reachable.
function templateCoach(weaknesses) {
  const tips = {
    csPerMin: 'Set a CS target and last-hit through the first back — aim to not miss minions while trading.',
    visPerMin: 'Use both trinket charges every time they are up and clear one enemy ward per recall.',
    kp: 'Group with your team for objectives — leave lane on a slow-push and join fights before they start.',
    deaths: 'Before each play ask "what kills me here?" and respect enemy cooldowns; ward before you push.',
    goldPerMin: 'Cut downtime: recall with purpose, then catch the wave — idle time is lost gold.',
    dmgPerMin: 'Reposition to hit the front line safely each fight instead of chasing kills you cannot reach.',
  };
  return weaknesses.map((g, i) => {
    const pct = Math.round(Math.abs(g.gap) * 100);
    const dir = g.dir === 'higher' ? 'below' : 'above';
    return `${i + 1}. ${g.label}: you're at ${fmt(g.key, g.player)} (~${pct}% ${dir} the ${fmt(g.key, g.target)} target). ` +
      (tips[g.key] || 'Focus on tightening this next game.');
  }).join('\n\n');
}

async function callGroq({ system, user, effort, maxTokens }) {
  const { url, headers } = groqTarget();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model: config.llm.groqModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.6,
      // 500 was enough for English but cut Cyrillic/CJK replies off mid-word
      // (those tokenize 2-3x heavier), which read as a text bug in the UI.
      // max_tokens covers reasoning + visible answer on gpt-oss, and at
      // 'medium' the reasoning alone can run past 900 — that returned an EMPTY
      // message and made the whole provider fall through silently.
      // Groq counts max_tokens as a RESERVATION against its 8000-tokens-per-
      // minute cap, not actual usage — a 2500 reservation on a 40-word live tip
      // meant two tips in a minute could 429. Callers that need little output
      // pass their own budget.
      max_tokens: maxTokens || (effort === 'medium' ? 2500 : 900),
      // gpt-oss are reasoning models — 'low' keeps latency fit for live tips,
      // but at that effort the non-English prose degrades into clipped and
      // invented words, so the post-game analysis asks for 'medium' instead
      // (nobody is watching a 60s clock for it).
      ...(config.llm.groqModel.includes('gpt-oss') ? { reasoning_effort: effort || 'low' } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`groq_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  // An empty message with finish_reason "length" means the reasoning ate the
  // budget. Without this line the provider chain just moved on in silence and
  // the token cap looked like "gemini is the primary provider".
  if (!choice?.message?.content && choice?.finish_reason === 'length') {
    throw new Error('groq_empty: reasoning consumed max_tokens');
  }
  return choice?.message?.content?.trim();
}

// OpenAI: no daily token ceiling, so it keeps working after the free tiers
// hit theirs. Same OpenAI-compatible shape as Groq, minus the reasoning knob.
async function callOpenAI({ system, user, maxTokens }) {
  const { url, headers } = openaiTarget();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model: config.llm.openaiModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      // The gpt-5.x family rejects `max_tokens` outright ("Unsupported
      // parameter") and only accepts `max_completion_tokens`; the 4o family
      // predates that rename. Send whichever the chosen model understands.
      ...(/^gpt-5/.test(config.llm.openaiModel)
        ? { max_completion_tokens: maxTokens || 900 }
        : { max_tokens: maxTokens || 900, temperature: 0.6 }),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`openai_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim();
}

// Gemini with Google Search grounding — used for meta/guide lookups so the
// bot can cite CURRENT-patch builds instead of stale training data.
async function callGeminiGrounded({ system, user }) {
  const { url, headers } = geminiTarget(config.llm.geminiModel);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
      // thinkingBudget 0: otherwise 2.5-flash spends the token budget on
      // internal reasoning and the visible brief arrives truncated.
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`gemini_search_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
}

// Web-grounded answer with graceful degradation: search-backed Gemini first,
// plain chain second (still useful — just without live-patch freshness).
export async function groundedAnswer({ system, user }) {
  if (canGemini) {
    try {
      const text = await callGeminiGrounded({ system, user });
      if (text) return { text: plainText(text), source: 'gemini-search' };
    } catch (e) {
      console.warn('[llm] grounded search failed, falling back to plain LLM:', String(e.message).slice(0, 90));
    }
  }
  const r = await callLLM(system, user);
  return r ? { text: r.text, source: r.provider } : { text: null, source: 'none' };
}

// Gemini free tier — text fallback and the only vision provider.
async function callGemini({ system, user }) {
  const { url, headers } = geminiTarget(config.llm.geminiModel);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // thinkingBudget: 0 — flash models reason internally by default, which
      // burns latency and output tokens we don't need for short coaching text.
      // 900 (was 700) for the same reason as Groq: Cyrillic/CJK answers were
      // being truncated in the middle of a sentence.
      generationConfig: { temperature: 0.6, maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
}

// Fallback chain: primary provider first, then the other one if it has a
// key. One capped free tier (e.g. Gemini's daily 429) no longer downgrades
// the coaching to templates — the next provider picks it up.
// (Ollama and Anthropic were removed 2026-07-19: the Ollama cloud model was
// retired and its 60s timeout only delayed the template fallback.)
const PROVIDER_CALLS = { openai: callOpenAI, groq: callGroq, gemini: callGemini };

function providerChain() {
  const order = [config.llm.provider, 'openai', 'groq', 'gemini'];
  const chain = [];
  for (const p of order) {
    if (chain.includes(p) || !PROVIDER_CALLS[p]) continue;
    if (p === 'openai' && !canOpenAI) continue;
    if (p === 'groq' && !canGroq) continue;
    if (p === 'gemini' && !canGemini) continue;
    chain.push(p);
  }
  return chain;
}

// Returns { text, provider } or null (provider 'none' / all failed → throws last error).
async function callLLM(system, user, opts = {}) {
  if (config.llm.provider === 'none') return null;
  const prompt = { system, user, ...opts };
  // Every provider's failure is kept, not just the last one. A play-test where
  // all tips fell back reported only "gemini_429" — the reason Groq (the
  // primary) had failed was thrown away, which made it undiagnosable.
  const failures = [];
  for (const p of providerChain()) {
    try {
      const text = await PROVIDER_CALLS[p](prompt);
      if (text) return { text: plainText(text), provider: p };
      failures.push(`${p}: empty`);
    } catch (e) {
      failures.push(`${p}: ${String(e.message).slice(0, 60)}`);
      console.warn(`[llm] ${p} failed (${String(e.message).slice(0, 90)}) — trying next provider`);
    }
  }
  if (failures.length) throw new Error(failures.join(' | '));
  return null;
}

// One short, live, actionable recommendation from the current game state.
// Falls back to the top rule-based nudge if the LLM is unreachable.
// Role changes what good advice even IS — a support must never hear "farm more".
const ROLE_BRIEF = {
  UTILITY: 'The player is the SUPPORT. NEVER advise farming minions or CS. Talk about: vision control and denying enemy wards, roaming to mid/jungle after shoving, peeling for the ADC in fights, engage/disengage timing, warding objectives 30-60s before they spawn, and staying alive (a dead support gives the enemy free vision control).',
  JUNGLE: 'The player is the JUNGLER — the one player who decides WHERE the next fight happens, so ' +
    'always name a destination: a specific lane to gank, a camp side to path to, or an objective to set up. ' +
    'Talk about: pathing toward winnable lanes, securing/trading objectives, ganking lanes that have CC and ' +
    'priority, counter-jungling when the enemy jungler shows elsewhere, and tracking the enemy jungler for ' +
    'your laners. Their CS is CAMPS, never lane minions.',
  BOTTOM: 'The player is the ADC. Talk about: positioning in fights (hit the nearest safe target, never front-line), catching side waves only when safe, staying attached to the support, and never face-checking bushes.',
  MIDDLE: 'The player is the MID LANER. Talk about: shoving the wave before roaming, roam timings to side lanes or objectives, and tracking the enemy jungler before stepping up.',
  TOP: 'The player is the TOP LANER. Talk about: wave management (freeze vs shove), Teleport plays to bot/objectives, and split-push timing versus grouping with the team.',
};

const PHASE_BRIEF = {
  early: 'Laning phase. Advice should be about waves, trades, jungle tracking and the first objectives.',
  mid: 'Mid game. Advice should be about grouping, picks, vision before objectives and side-wave management.',
  late: 'LATE GAME. Deaths are near-unpunishable — one bad pick loses Baron and the game. Do NOT give farming or CS advice. Talk about not getting caught, vision before Baron/Elder, waiting for picks, and what to do with the next 90 seconds around objectives.',
};

// The whole board as prompt lines — shared by the text tip and the vision tip.
function buildContextLines(me, gameTimeSec, role, ctx) {
  const min = Math.max(gameTimeSec / 60, 0.5);
  const phase = ctx?.phase || 'mid';
  // CS with its target: given a bare number the model had no way to know
  // whether the farm was good, so it fell back to "farm more" even when the
  // player was ahead of the benchmark for their role.
  const csPerMin = me.cs / min;
  const csTarget = (BENCHMARKS[role] || BENCHMARKS.MIDDLE)[ctx?.bucket || 'mid']?.csPerMin;
  const csNote = csTarget
    ? ` — target for ${role} is ~${csTarget}/min, so this is ${csPerMin >= csTarget ? 'FINE, do NOT tell them to farm more' : 'behind'}`
    : '';

  const lines = [
    `You: ${me.champion} (${role}) lvl ${me.level}, KDA ${me.kills}/${me.deaths}/${me.assists}, ` +
      `CS ${me.cs} (${csPerMin.toFixed(1)}/min${csNote}), vision ${me.wardScore}, ${me.gold}g unspent.`,
    `Clock: ${Math.round(gameTimeSec / 60)} min (${phase} game).`,
  ];
  // A champion that is dead right now must never be described as a live
  // threat, so mark the status everywhere the name appears.
  const deadMap = new Map((ctx?.deadEnemies || []).map(e => [e.champion, e.respawnIn]));
  const mark = champ => (deadMap.has(champ) ? `${champ} (DEAD, back in ${deadMap.get(champ)}s)` : champ);

  if (ctx) {
    // What has actually been happening. A snapshot of the score cannot tell the
    // coach that the enemy just took Baron or that the player has died twice in
    // two minutes, which is why its late-game advice read as generic.
    if (ctx.timeline?.recent?.length) {
      lines.push('WHAT JUST HAPPENED (last 2 minutes, newest last):\n  ' +
        ctx.timeline.recent.join('\n  ') +
        `\nMomentum: ${ctx.timeline.summary}. React to THIS — if the team just lost a fight, ` +
        'stabilise instead of forcing; if they just won one, say what to convert it into.');
    } else if (ctx.timeline?.summary) {
      lines.push(`Momentum: ${ctx.timeline.summary}.`);
    }
    // Silence about deaths was being filled in by the model — it invented "Zed
    // is dead 40s" from a name it saw elsewhere in the context. Say it plainly.
    if (!ctx.deadEnemies?.length) {
      lines.push('EVERY ENEMY IS ALIVE right now. Do NOT claim anyone is dead and do NOT invent a respawn timer.');
    }
    // Highest-value fact first: a dead enemy is a timed window to take something.
    if (ctx.deadEnemies?.length) {
      lines.push('*** WINDOW OPEN — DEAD ENEMIES: ' + ctx.deadEnemies
        .map(e => `${e.champion} back in ${e.respawnIn}s`).join(', ') +
        '. Your advice MUST use this window (objective, tower, deep vision) and say what to take before they respawn. ***');
    }
    lines.push(`Score: your team ${ctx.teamKills} kills vs enemy ${ctx.enemyKills}.`);
    // Spelled out, never "1:0" — a bare score was read backwards ("my inhib is
    // down") and produced defend-your-base advice while the player was the one
    // pushing with super minions.
    lines.push(
      `Objectives TAKEN BY YOUR TEAM: ${ctx.dragons.mine} dragons, ${ctx.barons.mine} barons, ` +
      `${ctx.turrets.mine} enemy turrets, ${ctx.inhibs.mine} enemy inhibitors.\n` +
      `Objectives TAKEN BY THE ENEMY: ${ctx.dragons.theirs} dragons, ${ctx.barons.theirs} barons, ` +
      `${ctx.turrets.theirs} of your turrets, ${ctx.inhibs.theirs} of your inhibitors.`);
    if (ctx.inhibs.mine > 0) {
      lines.push(`YOU BROKE ${ctx.inhibs.mine} ENEMY INHIBITOR(S): YOUR team has super minions pushing INTO THE ENEMY BASE. ` +
        'This is your advantage — press it (siege with the wave, take the next objective). ' +
        'Do NOT tell the player to clear super minions or defend: those minions are on your side.');
    }
    if (ctx.inhibs.theirs > 0) {
      lines.push(`The enemy broke ${ctx.inhibs.theirs} of your inhibitors: THEIR super minions are pushing into YOUR base — clearing them is defence work.`);
    }
    if (ctx.dragons.theirs === 3) lines.push('WARNING: enemy is one dragon from Dragon Soul.');
    if (ctx.dragons.mine === 3) lines.push('Your team is one dragon from Dragon Soul.');
    if (ctx.baronUpIn <= 60) lines.push(`Baron is up or spawning in ~${Math.max(0, ctx.baronUpIn)}s.`);
    if (ctx.isDead) lines.push(`YOU ARE DEAD — respawn in ${ctx.respawnTimer}s.`);
    if (ctx.enemyAvgLevel) lines.push(`Levels: you ${ctx.myLevel} vs enemy average ${ctx.enemyAvgLevel}.`);
    if (ctx.fedEnemy) lines.push(`Biggest threat: ${mark(ctx.fedEnemy.champion)} ${ctx.fedEnemy.k}/${ctx.fedEnemy.d}/${ctx.fedEnemy.a}.`);
    if (typeof ctx.goldDiff === 'number') {
      const side = ctx.goldDiff >= 0 ? 'ahead' : 'behind';
      lines.push(`Item gold: your team is ${Math.abs(ctx.goldDiff)}g ${side} (${ctx.teamItemGold} vs ${ctx.enemyItemGold}).`);
    }
    if (ctx.enemyDamage && (ctx.enemyDamage.ad || ctx.enemyDamage.ap)) {
      lines.push(`Enemy damage split: ${ctx.enemyDamage.ad} AD / ${ctx.enemyDamage.ap} AP. ` +
        `Your resists: ${ctx.myArmor} armor, ${ctx.myMagicResist} MR — recommend a defensive item if they are low for this stage.`);
    }
    if (ctx.nemesis) lines.push(`${mark(ctx.nemesis.champion)} has killed you ${ctx.nemesis.times} times this game.`);
    if (ctx.myKP != null) lines.push(`Your kill participation: ${ctx.myKP}%.`);

    // Concrete state — without these the model can only give generic macro,
    // and it tends to invent items the player already owns.
    if (ctx.myHpPct != null) {
      lines.push(`Your health: ${ctx.myHpPct}%` +
        (ctx.myResourcePct != null ? `, resource ${ctx.myResourcePct}%` : '') +
        (ctx.ultLevel ? ', ultimate is learned' : ', no ultimate yet') + '.');
    }
    if (ctx.myItems?.length) {
      lines.push(`Your items: ${ctx.myItems.join(', ')}. NEVER recommend an item already in this list.`);
    }
    if (ctx.enemyBuilds?.length) {
      lines.push('Enemy builds: ' + ctx.enemyBuilds
        .filter(e => e.items.length)
        .map(e => `${e.champion} [${e.items.join(', ')}]`).join('; ') + '.');
    }
    // Worked out from the real inventories on both sides (see counterbuild.js),
    // so it is a fact, not something to re-derive from the item list above.
    if (ctx.counter) {
      lines.push(`COUNTER-BUILD READ: ${ctx.counter.text}` +
        (ctx.myCurrentGold != null ? ` You are carrying ${ctx.myCurrentGold} gold.` : ''));
    }
    if (ctx.enemies?.length) {
      lines.push('Enemy team: ' + ctx.enemies.map(p => `${mark(p.champion)} ${p.k}/${p.d}/${p.a} lvl${p.lvl}`).join(', ') + '.');
    }
    if (ctx.allies?.length) {
      lines.push('Your team: ' + ctx.allies.map(p => `${p.champion} ${p.k}/${p.d}/${p.a} lvl${p.lvl}`).join(', ') + '.');
    }
  }
  return lines;
}

const COACH_SYSTEM = (phase, lang, role) => {
  return 'You are a sharp League of Legends coach watching a LIVE game with the full scoreboard ' +
    'in front of you. Tell the player what to do in the next 60-90 seconds.\n' +

    // Priority order matters more than any rule: without it the model latches
    // onto whatever is listed first instead of what actually decides the game.
    'PICK WHAT MATTERS MOST, in this order:\n' +
    '1. Dead enemies + their respawn timers — that is the window; name what to take with it.\n' +
    '2. An objective spawning or up right now (dragon/baron/soul point).\n' +
    '3. You are low HP / out of resource, or a big item is affordable.\n' +
    '3b. A COUNTER-BUILD READ, if you were given one. Unlike a respawn timer this stays true all ' +
    'game, so YOU choose the moment: best while they are dead, recalling, or holding enough gold — ' +
    'and always better than repeating a macro tip. Say it once; if it is still in the read later, ' +
    'that means they have not bought it, so raise it again only when a fight just showed why.\n' +
    '4. A specific enemy who is fed or keeps killing you.\n' +
    '5. Only if none of the above: role/phase fundamentals.\n' +

    'HOW TO WRITE IT:\n' +
    '- Lead with the action, not the observation. "Take dragon now" beats "dragon is up".\n' +
    '- The FIRST WORD must be a verb giving an order to the player ("Take", "Ward", "Back off", ' +
    '"Buy"). Never open with the dictionary form of a verb, a noun phrase, or a description — in ' +
    'languages that distinguish them, that means the imperative, never the infinitive.\n' +
    '- Anchor to something real you were given: a champion name, a timer, a number, an item.\n' +
    '- One concrete action, plus the reason in the same breath. Then stop.\n' +
    '- If you name a threat, say the counter-play (where to stand, what to buy, what to wait for).\n' +

    // The recurring complaint about this coach is that it states the obvious.
    // A ranked player already knows "farm and don't feed"; what they cannot see
    // mid-fight is the specific lever available to THEM right now.
    'DEPTH — this is what separates a coach from a loading-screen tip:\n' +
    '- Say something the player does NOT already know. If your sentence would be true in any game, ' +
    'on any champion, at any rank, it is worthless — delete it and find the specific lever.\n' +
    '- Use the tools THIS player has: their champion\'s kit, their exact items and gold, the enemy\'s ' +
    'build, a level or timer advantage. "You just hit level 6" or "they have no Grievous Wounds yet" ' +
    'beats any amount of general macro.\n' +
    '- Give the causal chain in one breath: do X, because Y, which gets you Z. The Z is the part ' +
    'that makes it coaching rather than an instruction.\n' +
    '- Prefer a window that is open for the next minute over a habit that takes ten games to build.\n' +

    'NEVER: bare warnings ("be careful", "don\'t go alone"), beginner platitudes ("farm safely", ' +
    '"don\'t feed", "play well", "ward more", "group with your team" on its own), combo/mechanics ' +
    'spam, recommending an item the player already owns, or treating a dead enemy as a live threat.\n' +

    'GOOD: "Zed is dead 34s and your jungler is bot — take dragon now, it is free and it puts you on ' +
    'soul point before their next reset."\n' +
    'GOOD: "You have 3200g and no MR vs their 4 AP — buy Force of Nature this back; it turns their ' +
    'Kai\'Sa burst into a survivable trade so you can hold mid."\n' +
    'BAD: "Caitlyn has 15 kills, be careful around her." (warning with no plan)\n' +
    'BAD: "Focus on farming and playing safe." (true in every game — worthless)\n' +
    'BAD: "Ward the river and help your team." (no lever, no consequence)\n' +

    'Max 45 words. No preamble, no bullet labels, speak directly ("you"). ' +
    PHASE_BRIEF[phase] + ' ' + (ROLE_BRIEF[role] || '') +
    FORMAT_RULE + shortLanguageRule(lang);
};

export async function liveTip({ me, gameTimeSec, role, nudges, ctx, lang, recentTips = [] }) {
  const phase = ctx?.phase || 'mid';
  const system = COACH_SYSTEM(phase, lang, role);
  const lines = buildContextLines(me, gameTimeSec, role, ctx);
  // Each tip was generated with no idea what the previous ones said, so the
  // coach circled one theme for a whole match — a 55-minute game got "clear
  // vision near Baron" four separate times, reworded.
  if (recentTips.length) {
    lines.push('\nYOU ALREADY TOLD THIS PLAYER, most recent last:\n  - ' + recentTips.join('\n  - ') +
      '\nDo NOT repeat those points or restate them in different words. If the situation genuinely ' +
      'has not moved on, pick a DIFFERENT angle that is still true — their build, a cooldown, a ' +
      'teammate to group with, where to stand in the next fight, what to do with the wave.');
  }
  lines.push('What is the single most useful thing to do right now?');
  const user = lines.join('\n');
  let why = 'no_provider';
  try {
    // medium, like the post-game coach: at low effort the model drops into
    // infinitives and slips Russian words into Ukrainian tips.
    const r = await callLLM(system, user, { effort: 'medium', maxTokens: 1100 });
    if (r?.text) return { tip: r.text.trim(), source: r.provider };
    why = 'empty_response';
  } catch (e) {
    // Carried out to the caller: a play-test showed ~20% of live tips falling
    // back to templates with no way to tell a rate limit from a timeout.
    why = String(e.message).slice(0, 120);
    console.warn('[llm] liveTip failed:', e.message);
  }
  // No LLM reachable: hand back a nudge CODE so the client can render it in the
  // player's language (an English string here would ignore the language switch).
  const fb = nudges && nudges.length ? nudges[0] : null;
  return fb
    ? { tip: null, code: fb.code, params: fb.params, source: 'template', why }
    : { tip: null, code: 'safeDefault', source: 'template', why };
}

// Vision coaching: the model literally looks at a screenshot of the player's
// screen (minimap, team positions, health bars, fog) on top of the structured
// game state. Passive screen-reading only — the "coach over your shoulder"
// model, no automation. Gemini-only: it's our multimodal-capable provider.
async function geminiVision({ system, user, imageBase64, minimapBase64 }) {
  const parts = [{ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }];
  if (minimapBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: minimapBase64 } });
  parts.push({ text: user });
  const { url, headers } = geminiTarget(config.llm.geminiModel);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`gemini_vision_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim() || null;
}

// Groq's Llama-4 models take images via OpenAI-style image_url data URLs.
async function groqVision({ system, user, imageBase64, minimapBase64 }) {
  const content = [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }];
  if (minimapBase64) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${minimapBase64}` } });
  content.push({ type: 'text', text: user });
  const { url, headers } = groqTarget();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model: config.llm.groqVisionModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
      temperature: 0.6,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`groq_vision_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

export async function visionTip({ imageBase64, minimapBase64, me, gameTimeSec, role, ctx, lang }) {
  const phase = ctx?.phase || 'mid';
  const system = COACH_SYSTEM(phase, lang, role) +
    ' You are ALSO given a live screenshot of their screen' +
    (minimapBase64 ? ' AND a zoomed-in crop of the minimap' : '') +
    '. READ THE MINIMAP FIRST: where are both teams, which enemies are MISSING from it, is the ' +
    'player pushed up with no vision, is an objective being set up. If enemies are missing or the ' +
    'player is in a dangerous spot, your tip MUST say so. Prefer what the screen shows over ' +
    'generic macro. Max 50 words.';
  const lines = buildContextLines(me, gameTimeSec, role, ctx);
  lines.push('Based on the screenshot and this state: what should the player do right now?');
  const args = { system, user: lines.join('\n'), imageBase64, minimapBase64 };

  // Same chain idea as text tips: Gemini first, Groq's multimodal Llama-4 next.
  const attempts = [];
  if (canGemini) attempts.push(['gemini', geminiVision]);
  if (canGroq && config.llm.groqVisionModel) attempts.push(['groq', groqVision]);
  let lastErr = null;
  for (const [name, fn] of attempts) {
    try {
      const text = await fn(args);
      if (text) return plainText(text);
    } catch (e) {
      lastErr = e;
      console.warn(`[llm] vision ${name} failed (${String(e.message).slice(0, 90)}) — trying next`);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// Returns { text, source }. Falls back to a template if the provider fails,
// so a capped provider or missing key never breaks the analysis.
export async function coach(ctx) {
  const prompt = buildPrompt(ctx);
  try {
    // 'medium' reasoning: the post-game write-up is long-form prose in the
    // player's own language and 'low' effort produced clipped/invented words.
    // The budget has to cover ~420 words of Ukrainian AND the reasoning tokens,
    // which share the same ceiling on gpt-5 — the default 900 truncated the
    // report mid-sentence once the write-up grew past three short points.
    const r = await callLLM(prompt.system, prompt.user, { effort: 'medium', maxTokens: 2600 });
    if (r?.text) return { text: r.text, source: r.provider };
  } catch (e) {
    console.warn('[llm] all providers failed, using template fallback:', e.message);
  }
  return { text: templateCoach(ctx.weaknesses), source: 'template' };
}
