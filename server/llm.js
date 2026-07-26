import { config } from './config.js';
import { METRICS, BENCHMARKS } from './benchmarks.js';
import { groqTarget, geminiTarget, canGroq, canGemini } from './upstream.js';

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

function buildPrompt({ rank, role, bucket, roleMixed, weaknesses, lang, progress }) {
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

  // Trends vs their own previous sessions — the coach should react to them
  // (praise real improvement once, focus the fixes on what is NOT moving).
  let progressNote = '';
  if (progress && progress.length) {
    const fmtT = t => `${t.key}: ${t.from.toFixed(2)} → ${t.to.toFixed(2)} (${t.better ? 'improving' : 'getting worse'})`;
    progressNote =
      '\nProgress vs their recent sessions:\n' + progress.map(fmtT).join('\n') +
      '\nOpen with ONE short sentence acknowledging the biggest improvement (if any), then focus the 3 fixes on what is stagnant or getting worse.';
  }

  const user =
    `This player is ${rankStr}, playing mostly ${role}.\n` +
    (ROLE_BRIEF[role] ? ROLE_BRIEF[role] + '\n' : '') +
    `Their 3 biggest personal weaknesses vs players at their level:\n` +
    weaknesses.map(gapLine).join('\n') + mixNote + progressNote +
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
  const { url, headers } = groqTarget();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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
      if (text) return { text, source: 'gemini-search' };
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
    if (p === 'groq' && !canGroq) continue;
    if (p === 'gemini' && !canGemini) continue;
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
  const langName = LANG_NAMES[lang] || 'English';
  return 'You are a sharp League of Legends coach watching a LIVE game with the full scoreboard ' +
    'in front of you. Tell the player what to do in the next 60-90 seconds.\n' +

    // Priority order matters more than any rule: without it the model latches
    // onto whatever is listed first instead of what actually decides the game.
    'PICK WHAT MATTERS MOST, in this order:\n' +
    '1. Dead enemies + their respawn timers — that is the window; name what to take with it.\n' +
    '2. An objective spawning or up right now (dragon/baron/soul point).\n' +
    '3. You are low HP / out of resource, or a big item is affordable.\n' +
    '4. A specific enemy who is fed or keeps killing you.\n' +
    '5. Only if none of the above: role/phase fundamentals.\n' +

    'HOW TO WRITE IT:\n' +
    '- Lead with the action, not the observation. "Take dragon now" beats "dragon is up".\n' +
    '- Anchor to something real you were given: a champion name, a timer, a number, an item.\n' +
    '- One concrete action, plus the reason in the same breath. Then stop.\n' +
    '- If you name a threat, say the counter-play (where to stand, what to buy, what to wait for).\n' +

    'NEVER: bare warnings ("be careful", "don\'t go alone"), filler ("farm safely", "play well"), ' +
    'combo/mechanics spam, recommending an item the player already owns, or telling a dead enemy\'s ' +
    'threat as if they were alive.\n' +

    'GOOD: "Zed is dead 34s — take dragon now with your jungler, you have the numbers."\n' +
    'GOOD: "You have 3200g and no MR vs their 4 AP — buy Force of Nature this back, then group mid."\n' +
    'BAD: "Caitlyn has 15 kills, be careful around her." (warning with no plan)\n' +
    'BAD: "Focus on farming and playing safe." (generic filler)\n' +

    'Max 40 words. No preamble, no bullet labels, speak directly ("you"). ' +
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
