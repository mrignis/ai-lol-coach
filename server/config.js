import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3000,
  riotKey: process.env.RIOT_API_KEY || '',
  llm: {
    provider: (process.env.LLM_PROVIDER || 'ollama').toLowerCase(),
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen3-coder:480b-cloud',
    groqKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  },
};

// Platforms shown in the UI region dropdown.
export const PLATFORMS = [
  { id: 'na1', label: 'NA' },
  { id: 'euw1', label: 'EUW' },
  { id: 'eun1', label: 'EUNE' },
  { id: 'kr', label: 'KR' },
  { id: 'br1', label: 'BR' },
  { id: 'jp1', label: 'JP' },
  { id: 'la1', label: 'LAN' },
  { id: 'la2', label: 'LAS' },
  { id: 'oc1', label: 'OCE' },
  { id: 'tr1', label: 'TR' },
  { id: 'ru', label: 'RU' },
];

// Match-V5 / Account-V1 use REGIONAL routing clusters, not the platform host.
const PLATFORM_TO_REGIONAL = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea',
};

export function platformToRegional(platform) {
  return PLATFORM_TO_REGIONAL[platform] || 'americas';
}

// Account-V1 has no 'sea' cluster; puuid is global so any cluster resolves it.
export function accountRegional(platform) {
  const r = platformToRegional(platform);
  return r === 'sea' ? 'americas' : r;
}
