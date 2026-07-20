import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, PLATFORMS } from './config.js';
import { analyzePlayer } from './analyze.js';
import { fetchLiveData, buildLiveResponse, liveCoachResponse } from './live.js';
import { visionTip } from './llm.js';
import { matchupBrief } from './meta.js';
import { getNews } from './news.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '10mb' })); // vision screenshots arrive as base64 JPEG
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
    res.json(await buildLiveResponse(data, bucket));
  } catch (e) {
    if (e.code === 'NOGAME') return res.json({ inGame: false });
    console.error('[live]', e.message);
    res.json({ inGame: false, error: 'live_read_failed' });
  }
});

// AI live recommendation — LLM reads the current game state (polled ~60s).
// Latest screen-based tip. The Electron overlay posts a screenshot every ~60s;
// we analyse it eagerly and the widget picks the result up on its next poll.
let visionState = { tip: null, ts: 0 };
let textTipState = { data: null, ts: 0, lang: 'en' };
let lastCoachLang = 'en'; // vision calls happen out-of-band, so remember the UI language

app.get('/api/live-coach', async (req, res) => {
  const bucket = ['low', 'mid', 'high'].includes(req.query.bucket) ? req.query.bucket : 'mid';
  lastCoachLang = req.query.lang || lastCoachLang;
  try {
    // A fresh vision tip (screen + state) beats a state-only tip.
    if (visionState.tip && Date.now() - visionState.ts < 90000) {
      return res.json({ inGame: true, ready: true, tip: visionState.tip, source: 'vision' });
    }
    // Text tips cost an LLM call each — cache 45s so the 30s widget poll
    // doesn't double our daily quota burn (free tiers are small).
    if (textTipState.data && Date.now() - textTipState.ts < 45000 && textTipState.lang === (req.query.lang || 'en')) {
      return res.json(textTipState.data);
    }
    const out = await liveCoachResponse(bucket, req.query.lang || 'en');
    if (out.ready && out.tip) textTipState = { data: out, ts: Date.now(), lang: req.query.lang || 'en' };
    res.json(out);
  } catch (e) {
    if (e.code === 'NOGAME') return res.json({ inGame: false });
    console.error('[live-coach]', e.message);
    res.json({ inGame: false });
  }
});

// Pre-game matchup briefing: current-patch build + matchup plan for the
// champion the player just locked, web-grounded and cached per patch.
app.get('/api/matchup', async (req, res) => {
  try {
    const data = await fetchLiveData();
    const base = await buildLiveResponse(data, 'mid');
    if (!base.ready) return res.json({ inGame: base.inGame !== false, ready: false });
    const brief = await matchupBrief({
      champ: base.me.champion,
      vs: base.ctx.enemyLaner,
      role: base.me.role,
      lang: req.query.lang || 'en',
    });
    res.json({ inGame: true, ready: true, ...brief });
  } catch (e) {
    if (e.code === 'NOGAME') return res.json({ inGame: false });
    console.error('[matchup]', e.message);
    res.json({ inGame: false, error: 'matchup_failed' });
  }
});

// Electron posts { image: <base64 jpeg> } here while a game is running.
app.post('/api/vision', async (req, res) => {
  const { image, minimap, bucket } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });
  try {
    const data = await fetchLiveData();
    const base = await buildLiveResponse(data, ['low', 'mid', 'high'].includes(bucket) ? bucket : 'mid');
    if (!base.ready) return res.json({ ok: false });
    const tip = await visionTip({
      imageBase64: image,
      minimapBase64: minimap || null,
      me: base.me,
      gameTimeSec: base.gameTimeSec,
      role: base.me.role,
      ctx: base.ctx,
      lang: lastCoachLang,
    });
    if (tip) visionState = { tip, ts: Date.now() };
    res.json({ ok: !!tip });
  } catch (e) {
    if (e.code !== 'NOGAME') console.error('[vision]', e.message);
    res.json({ ok: false });
  }
});

app.listen(config.port, () => {
  console.log(`\n  AI LoL Coach → http://localhost:${config.port}`);
  console.log(`  Riot key: ${config.riotKey ? 'set' : 'MISSING (add RIOT_API_KEY to .env)'}`);
  console.log(`  LLM provider: ${config.llm.provider}\n`);
});
