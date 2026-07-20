import { config } from './config.js';
import { METRICS } from './benchmarks.js';

const fmt = (key, v) => (METRICS[key] ? METRICS[key].fmt(v) : String(v));

// Turn a gap into a one-line "your number vs target" fact for the prompt.
function gapLine(g) {
  const pct = Math.round(Math.abs(g.gap) * 100);
  const side = g.gap > 0
    ? (g.dir === 'higher' ? `${pct}% below target` : `${pct}% above target`)
    : 'at or above target';
  return `- ${g.label}: you average ${fmt(g.key, g.player)} vs a target of ${fmt(g.key, g.target)} (${side})`;
}

// lang code → language the LLM should reply in.
const LANG_NAMES = {
  en: 'English', uk: 'Ukrainian', fr: 'French', de: 'German', es: 'Spanish',
  pl: 'Polish', pt: 'Brazilian Portuguese', ru: 'Russian', tr: 'Turkish',
  ko: 'Korean', zh: 'Simplified Chinese', ja: 'Japanese', vi: 'Vietnamese',
};

function buildPrompt({ rank, role, bucket, roleMixed, weaknesses, lang }) {
  const langName = LANG_NAMES[lang] || 'English';
  const system =
    'You are a friendly, direct League of Legends coach. You know THIS player from their ' +
    'own recent games — never give generic tier-list advice. No filler. Speak to them directly ("you"). ' +
    'For each weakness: name the problem plainly, cite their own number vs the benchmark, and give ONE ' +
    'specific thing to do next game. Keep the whole reply under 250 words. Output 3 short numbered points.' +
    (lang && lang !== 'en' ? ` Write your entire response in natural, fluent, grammatically correct ${langName} — no translation artifacts or awkward calques.` : '');

  const rankStr = rank ? `${rank.tier} ${rank.rank} (${bucket}-elo benchmarks)` : `unranked (${bucket}-elo benchmarks)`;
  const mixNote = roleMixed
    ? '\nNote: they play multiple roles, so numbers are blended across roles — acknowledge this if relevant.'
    : '';

  const user =
    `This player is ${rankStr}, playing mostly ${role}.\n` +
    (ROLE_BRIEF[role] ? ROLE_BRIEF[role] + '\n' : '') +
    `Their 3 biggest personal weaknesses vs players at their level:\n` +
    weaknesses.map(gapLine).join('\n') + mixNote +
    `\n\nWrite their "3 things to fix" now.`;

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

async function callGroq({ system, user }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.groqKey}` },
    body: JSON.stringify({
      model: config.llm.groqModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.6,
      max_tokens: 500,
      // gpt-oss are reasoning models — low effort keeps latency fit for live tips.
      ...(config.llm.groqModel.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`groq_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim();
}

// Gemini free tier — text fallback and the only vision provider.
async function callGemini({ system, user }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.llm.geminiModel}:generateContent?key=${config.llm.geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // thinkingBudget: 0 — flash models reason internally by default, which
      // burns latency and output tokens we don't need for short coaching text.
      generationConfig: { temperature: 0.6, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } },
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
const PROVIDER_CALLS = { groq: callGroq, gemini: callGemini };

function providerChain() {
  const order = [config.llm.provider, 'groq', 'gemini'];
  const chain = [];
  for (const p of order) {
    if (chain.includes(p) || !PROVIDER_CALLS[p]) continue;
    if (p === 'groq' && !config.llm.groqKey) continue;
    if (p === 'gemini' && !config.llm.geminiKey) continue;
    chain.push(p);
  }
  return chain;
}

// Returns { text, provider } or null (provider 'none' / all failed → throws last error).
async function callLLM(system, user) {
  if (config.llm.provider === 'none') return null;
  const prompt = { system, user };
  let lastErr = null;
  for (const p of providerChain()) {
    try {
      const text = await PROVIDER_CALLS[p](prompt);
      if (text) return { text, provider: p };
    } catch (e) {
      lastErr = e;
      console.warn(`[llm] ${p} failed (${String(e.message).slice(0, 90)}) — trying next provider`);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

// One short, live, actionable recommendation from the current game state.
// Falls back to the top rule-based nudge if the LLM is unreachable.
// Role changes what good advice even IS — a support must never hear "farm more".
const ROLE_BRIEF = {
  UTILITY: 'The player is the SUPPORT. NEVER advise farming minions or CS. Talk about: vision control and denying enemy wards, roaming to mid/jungle after shoving, peeling for the ADC in fights, engage/disengage timing, warding objectives 30-60s before they spawn, and staying alive (a dead support gives the enemy free vision control).',
  JUNGLE: 'The player is the JUNGLER. Talk about: pathing toward winnable lanes, securing/trading objectives, ganking lanes that have CC and priority, counter-jungling when the enemy jungler shows elsewhere, and tracking the enemy jungler for your laners.',
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
  const lines = [
    `You: ${me.champion} (${role}) lvl ${me.level}, KDA ${me.kills}/${me.deaths}/${me.assists}, ` +
      `CS ${me.cs} (${(me.cs / min).toFixed(1)}/min), vision ${me.wardScore}, ${me.gold}g unspent.`,
    `Clock: ${Math.round(gameTimeSec / 60)} min (${phase} game).`,
  ];
  if (ctx) {
    lines.push(`Score: your team ${ctx.teamKills} kills vs enemy ${ctx.enemyKills}.`);
    lines.push(`Objectives — dragons ${ctx.dragons.mine}:${ctx.dragons.theirs}, barons ${ctx.barons.mine}:${ctx.barons.theirs}, ` +
      `turrets ${ctx.turrets.mine}:${ctx.turrets.theirs}, inhibs ${ctx.inhibs.mine}:${ctx.inhibs.theirs}.`);
    if (ctx.dragons.theirs === 3) lines.push('WARNING: enemy is one dragon from Dragon Soul.');
    if (ctx.dragons.mine === 3) lines.push('Your team is one dragon from Dragon Soul.');
    if (ctx.baronUpIn <= 60) lines.push(`Baron is up or spawning in ~${Math.max(0, ctx.baronUpIn)}s.`);
    if (ctx.isDead) lines.push(`YOU ARE DEAD — respawn in ${ctx.respawnTimer}s.`);
    if (ctx.enemyAvgLevel) lines.push(`Levels: you ${ctx.myLevel} vs enemy average ${ctx.enemyAvgLevel}.`);
    if (ctx.fedEnemy) lines.push(`Biggest threat: ${ctx.fedEnemy.champion} ${ctx.fedEnemy.k}/${ctx.fedEnemy.d}/${ctx.fedEnemy.a}.`);
    if (typeof ctx.goldDiff === 'number') {
      const side = ctx.goldDiff >= 0 ? 'ahead' : 'behind';
      lines.push(`Item gold: your team is ${Math.abs(ctx.goldDiff)}g ${side} (${ctx.teamItemGold} vs ${ctx.enemyItemGold}).`);
    }
    if (ctx.enemyDamage && (ctx.enemyDamage.ad || ctx.enemyDamage.ap)) {
      lines.push(`Enemy damage split: ${ctx.enemyDamage.ad} AD / ${ctx.enemyDamage.ap} AP. ` +
        `Your resists: ${ctx.myArmor} armor, ${ctx.myMagicResist} MR — recommend a defensive item if they are low for this stage.`);
    }
    if (ctx.nemesis) lines.push(`${ctx.nemesis.champion} has killed you ${ctx.nemesis.times} times this game.`);
    if (ctx.myKP != null) lines.push(`Your kill participation: ${ctx.myKP}%.`);
    if (ctx.enemies?.length) {
      lines.push('Enemy team: ' + ctx.enemies.map(p => `${p.champion} ${p.k}/${p.d}/${p.a} lvl${p.lvl}`).join(', ') + '.');
    }
    if (ctx.allies?.length) {
      lines.push('Your team: ' + ctx.allies.map(p => `${p.champion} ${p.k}/${p.d}/${p.a} lvl${p.lvl}`).join(', ') + '.');
    }
  }
  return lines;
}

const COACH_SYSTEM = (phase, lang, role) => {
  const langName = LANG_NAMES[lang] || 'English';
  return 'You are a sharp League of Legends coach watching a LIVE game. You can see the whole ' +
    'scoreboard and objective state. Give ONE or TWO concrete actions for the next 90 seconds, ' +
    'grounded in the actual game state — every tip MUST reference at least one concrete detail ' +
    'you were given (a champion name, a number, a timer, an objective). Never give generic ' +
    'filler like "farm safely" or "play well". Never give mechanical spam. ' +
    'ACTION RULE: never end at a warning ("don\'t go alone", "be careful") — a warning is not ' +
    'advice. Every threat you name must come with the exact counter-play: WHERE to stand, WHAT ' +
    'to buy, WHICH cooldown or item spike to wait for, WHERE to ward, WHO engages first. ' +
    'Structure: threat → your concrete plan. Max 45 words total, ' +
    'no preamble, speak directly ("you"). ' +
    PHASE_BRIEF[phase] + ' ' + (ROLE_BRIEF[role] || '') +
    (lang && lang !== 'en' ? ` Reply in natural, grammatically correct ${langName}.` : '');
};

export async function liveTip({ me, gameTimeSec, role, nudges, ctx, lang }) {
  const phase = ctx?.phase || 'mid';
  const system = COACH_SYSTEM(phase, lang, role);
  const lines = buildContextLines(me, gameTimeSec, role, ctx);
  lines.push('What is the single most useful thing to do right now?');
  const user = lines.join('\n');
  try {
    const r = await callLLM(system, user);
    if (r?.text) return { tip: r.text.trim(), source: r.provider };
  } catch (e) {
    console.warn('[llm] liveTip failed:', e.message);
  }
  // No LLM reachable: hand back a nudge CODE so the client can render it in the
  // player's language (an English string here would ignore the language switch).
  const fb = nudges && nudges.length ? nudges[0] : null;
  return fb
    ? { tip: null, code: fb.code, params: fb.params, source: 'template' }
    : { tip: null, code: 'safeDefault', source: 'template' };
}

// Vision coaching: the model literally looks at a screenshot of the player's
// screen (minimap, team positions, health bars, fog) on top of the structured
// game state. Passive screen-reading only — the "coach over your shoulder"
// model, no automation. Gemini-only: it's our multimodal-capable provider.
async function geminiVision({ system, user, imageBase64, minimapBase64 }) {
  const parts = [{ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }];
  if (minimapBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: minimapBase64 } });
  parts.push({ text: user });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.llm.geminiModel}:generateContent?key=${config.llm.geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.groqKey}` },
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
  if (config.llm.geminiKey) attempts.push(['gemini', geminiVision]);
  if (config.llm.groqKey && config.llm.groqVisionModel) attempts.push(['groq', groqVision]);
  let lastErr = null;
  for (const [name, fn] of attempts) {
    try {
      const text = await fn(args);
      if (text) return text;
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
    const r = await callLLM(prompt.system, prompt.user);
    if (r?.text) return { text: r.text, source: r.provider };
  } catch (e) {
    console.warn('[llm] all providers failed, using template fallback:', e.message);
  }
  return { text: templateCoach(ctx.weaknesses), source: 'template' };
}
