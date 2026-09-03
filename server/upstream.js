import { config } from './config.js';

// Single place that decides HOW we reach Riot / Groq / Gemini.
//   proxy mode (PROXY_URL + PROXY_TOKEN set): go through the Cloudflare Worker
//     with only the app token — no upstream keys exist in the app at all.
//   direct mode (dev): call the upstream directly with a local key from .env.
const proxy = config.proxy;
export const hasProxy = !!proxy;

// True when we can reach an AI provider one way or another.
export const canGroq = hasProxy || !!config.llm.groqKey;
export const canGemini = hasProxy || !!config.llm.geminiKey;
export const canRiot = hasProxy || !!config.riotKey;

// region = routing value or platform host prefix (e.g. "americas", "na1").
// path   = everything after the host, query string included.
export function riotTarget(region, path) {
  if (proxy) {
    return { url: `${proxy.url}/riot/${region}/${path}`, headers: { Authorization: `Bearer ${proxy.token}` } };
  }
  return { url: `https://${region}.api.riotgames.com/${path}`, headers: { 'X-Riot-Token': config.riotKey } };
}

// Unlike the others, OpenAI is opt-in. In proxy mode we cannot see which
// secrets the worker holds, and assuming it has this one would add a failing
// round-trip to every fallback. Set OPENAI_ENABLED=1 (or a local key) to arm it.
export const canOpenAI = !!config.llm.openaiKey
  || (hasProxy && process.env.OPENAI_ENABLED === '1');

// A local key wins over the proxy: there is no reason to route through the
// worker when we can reach OpenAI directly, and it keeps working while the
// worker's own secret is not set up yet.
export function openaiTarget() {
  if (config.llm.openaiKey) {
    return { url: 'https://api.openai.com/v1/chat/completions', headers: { Authorization: `Bearer ${config.llm.openaiKey}` } };
  }
  return { url: `${proxy.url}/openai`, headers: { Authorization: `Bearer ${proxy.token}` } };
}

export function groqTarget() {
  if (proxy) return { url: `${proxy.url}/groq`, headers: { Authorization: `Bearer ${proxy.token}` } };
  return { url: 'https://api.groq.com/openai/v1/chat/completions', headers: { Authorization: `Bearer ${config.llm.groqKey}` } };
}

export function geminiTarget(model) {
  const m = `${model}:generateContent`;
  if (proxy) return { url: `${proxy.url}/gemini/${m}`, headers: { Authorization: `Bearer ${proxy.token}` } };
  return { url: `https://generativelanguage.googleapis.com/v1beta/models/${m}?key=${config.llm.geminiKey}`, headers: {} };
}
