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

async function callOllama({ system, user }) {
  const res = await fetch(`${config.llm.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.llm.ollamaModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      options: { temperature: 0.6 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`ollama_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.message?.content?.trim();
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
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`groq_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim();
}

// Gemini free tier. Note: gemini-flash-latest is the safe pin — some dated
// aliases 429 immediately on the free tier.
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

async function callAnthropic({ system, user }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.llm.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.llm.anthropicModel,
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`anthropic_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim();
}

// Dispatch a raw prompt to the configured provider (throws on failure).
async function callLLM(system, user) {
  const p = config.llm.provider;
  const prompt = { system, user };
  if (p === 'none') return null;
  if (p === 'groq' && config.llm.groqKey) return callGroq(prompt);
  if (p === 'gemini' && config.llm.geminiKey) return callGemini(prompt);
  if (p === 'anthropic' && config.llm.anthropicKey) return callAnthropic(prompt);
  return callOllama(prompt); // ollama default
}

// One short, live, actionable recommendation from the current game state.
// Falls back to the top rule-based nudge if the LLM is unreachable.
const PHASE_BRIEF = {
  early: 'Laning phase. Advice should be about waves, trades, jungle tracking and the first objectives.',
  mid: 'Mid game. Advice should be about grouping, picks, vision before objectives and side-wave management.',
  late: 'LATE GAME. Deaths are near-unpunishable — one bad pick loses Baron and the game. Do NOT give farming or CS advice. Talk about not getting caught, vision before Baron/Elder, waiting for picks, and what to do with the next 90 seconds around objectives.',
};

export async function liveTip({ me, gameTimeSec, role, nudges, ctx, lang }) {
  const min = Math.max(gameTimeSec / 60, 0.5);
  const langName = LANG_NAMES[lang] || 'English';
  const phase = ctx?.phase || 'mid';
  const system =
    'You are a sharp League of Legends coach watching a LIVE game. You can see the whole ' +
    'scoreboard and objective state. Give ONE concrete, specific thing to do in the next 90 ' +
    'seconds, grounded in the actual game state — reference the real numbers, champions or ' +
    'objectives you were given. Never give generic filler like "farm safely" or "play well". ' +
    'Never give mechanical spam. Max 30 words, no preamble, speak directly ("you"). ' +
    PHASE_BRIEF[phase] +
    (lang && lang !== 'en' ? ` Reply in natural, grammatically correct ${langName}.` : '');

  // Give the model the whole board — without this it can only generalise.
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
    if (ctx.enemies?.length) {
      lines.push('Enemy team: ' + ctx.enemies.map(p => `${p.champion} ${p.k}/${p.d}/${p.a} lvl${p.lvl}`).join(', ') + '.');
    }
    if (ctx.allies?.length) {
      lines.push('Your team: ' + ctx.allies.map(p => `${p.champion} ${p.k}/${p.d}/${p.a} lvl${p.lvl}`).join(', ') + '.');
    }
  }
  lines.push('What is the single most useful thing to do right now?');
  const user = lines.join('\n');
  try {
    const text = await callLLM(system, user);
    if (text) return { tip: text.trim(), source: config.llm.provider };
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

// Returns { text, source }. Falls back to a template if the provider fails,
// so a down Ollama or missing key never breaks the analysis.
export async function coach(ctx) {
  const prompt = buildPrompt(ctx);
  const provider = config.llm.provider;
  try {
    const text = await callLLM(prompt.system, prompt.user);
    if (text) return { text, source: provider };
  } catch (e) {
    console.warn(`[llm] ${provider} failed, using template fallback:`, e.message);
  }
  return { text: templateCoach(ctx.weaknesses), source: 'template' };
}
