import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Resolve .env by absolute path, never via the current working directory:
// Electron launches with an unpredictable cwd and an installed build has none.
// Keys are deliberately NOT bundled into the installer, so an installed copy
// reads them from the user's own config folder. First file to define a key
// wins, and a real environment variable always beats all of them.
const ENV_CANDIDATES = [
  path.join(HERE, '..', '.env'),                                   // dev checkout
  process.env.APPDATA && path.join(process.env.APPDATA, 'lol-coach', '.env'), // installed
  process.resourcesPath && path.join(process.resourcesPath, '.env'), // packaged resources
].filter(Boolean);

for (const p of ENV_CANDIDATES) dotenv.config({ path: p });

export const envPaths = ENV_CANDIDATES;

// The one the user is meant to edit. Not simply the last candidate: that is
// the packaged resources folder inside Program Files, which is read-only and
// would send people to the wrong file.
export const userEnvPath = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'lol-coach', '.env')
  : ENV_CANDIDATES[0];

export const config = {
  port: Number(process.env.PORT) || 3000,
  riotKey: process.env.RIOT_API_KEY || '',
  llm: {
    // groq | gemini | none. Ollama and Anthropic were removed 2026-07-19:
    // the Ollama cloud model was retired (410) and Anthropic never had a key.
    provider: (process.env.LLM_PROVIDER || 'groq').toLowerCase(),
    groqKey: process.env.GROQ_API_KEY || '',
    // gpt-oss-120b: smartest text model on Groq's free tier (Kimi K2 and
    // Llama-4 were removed from their catalog, 2026-07).
    groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    // Groq currently hosts no multimodal model; empty = skip Groq for vision.
    groqVisionModel: process.env.GROQ_VISION_MODEL || '',
    // GEMINI_API_KEY is usually already a system env var, so .env can stay empty.
    geminiKey: process.env.GEMINI_API_KEY || '',
    // flash-latest resolves to gemini-3.5-flash (free tier: only 20 req/day) —
    // default to 2.5-flash, which still has a usable free quota.
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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
