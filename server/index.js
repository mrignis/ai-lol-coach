import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, PLATFORMS } from './config.js';
import { analyzePlayer } from './analyze.js';
import { fetchLiveData, buildLiveResponse, liveCoachResponse } from './live.js';
import { getNews } from './news.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, riotKey: Boolean(config.riotKey), llm: config.llm.provider });
});

app.get('/api/regions', (req, res) => {
  res.json({ platforms: PLATFORMS });
});

// LoL news: current patch + this week's free champion rotation.
app.get('/api/news', async (req, res) => {
  const platform = PLATFORMS.some(p => p.id === req.query.region) ? req.query.region : 'na1';
  try {
    res.json(await getNews(platform));
  } catch (e) {
    console.error('[news]', e.message);
    res.json({ patch: null, rotation: [] });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { riotId, region, lang } = req.body || {};
  if (!riotId || !region) {
    return res.status(400).json({ error: 'riotId and region are required' });
  }
  if (!config.riotKey) {
    return res.status(500).json({ error: 'Server has no RIOT_API_KEY set. Add it to .env and restart.' });
  }
  try {
    const result = await analyzePlayer(riotId, region, { lang });
    res.json(result);
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    const messages = {
      404: 'Player or matches not found — check the Riot ID and region.',
      403: 'Riot API key was rejected. Dev keys expire every 24h — regenerate it.',
      429: 'Riot rate limit hit. Wait a moment and try again.',
    };
    console.error('[analyze]', e.message);
    res.status(code).json({ error: messages[code] || e.message || 'Analysis failed' });
  }
});

// Live in-game companion — reads League's local Live Client Data API.
// Returns {inGame:false} when no game is running (the widget just waits).
app.get('/api/live', async (req, res) => {
  const bucket = ['low', 'mid', 'high'].includes(req.query.bucket) ? req.query.bucket : 'mid';
  try {
    const data = await fetchLiveData();
    res.json(buildLiveResponse(data, bucket));
  } catch (e) {
    if (e.code === 'NOGAME') return res.json({ inGame: false });
    console.error('[live]', e.message);
    res.json({ inGame: false, error: 'live_read_failed' });
  }
});

// AI live recommendation — LLM reads the current game state (polled ~60s).
app.get('/api/live-coach', async (req, res) => {
  const bucket = ['low', 'mid', 'high'].includes(req.query.bucket) ? req.query.bucket : 'mid';
  try {
    res.json(await liveCoachResponse(bucket, req.query.lang || 'en'));
  } catch (e) {
    if (e.code === 'NOGAME') return res.json({ inGame: false });
    console.error('[live-coach]', e.message);
    res.json({ inGame: false });
  }
});

app.listen(config.port, () => {
  console.log(`\n  AI LoL Coach → http://localhost:${config.port}`);
  console.log(`  Riot key: ${config.riotKey ? 'set' : 'MISSING (add RIOT_API_KEY to .env)'}`);
  console.log(`  LLM provider: ${config.llm.provider}\n`);
});
