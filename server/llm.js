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
    (lang && lang !== 'en' ? ` Write your entire response in ${langName}.` : '');

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

// Returns { text, source }. Falls back to a template if the provider fails,
// so a down Ollama or missing key never breaks the analysis.
export async function coach(ctx) {
  const prompt = buildPrompt(ctx);
  const provider = config.llm.provider;
  try {
    let text;
    if (provider === 'ollama') text = await callOllama(prompt);
    else if (provider === 'groq' && config.llm.groqKey) text = await callGroq(prompt);
    else if (provider === 'anthropic' && config.llm.anthropicKey) text = await callAnthropic(prompt);
    else if (provider === 'none') text = null;
    else text = await callOllama(prompt); // default path

    if (text) return { text, source: provider };
  } catch (e) {
    console.warn(`[llm] ${provider} failed, using template fallback:`, e.message);
  }
  return { text: templateCoach(ctx.weaknesses), source: 'template' };
}
