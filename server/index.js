import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, PLATFORMS, userEnvPath, envReport } from './config.js';
import { canRiot, canGroq, canGemini } from './upstream.js';
import { analyzePlayer } from './analyze.js';
import { fetchLiveData, buildLiveResponse, liveCoachResponse } from './live.js';
import { visionTip } from './llm.js';
import { matchupBrief } from './meta.js';
import { getNews } from './news.js';
import { getChampions } from './ddragon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '10mb' })); // vision screenshots arrive as base64 JPEG
// no-store: Chromium kept serving the previous build's HTML/JS after an app
// update, so the window showed a stale UI against a fresh server. These files
// come off localhost — there is nothing to gain from caching them.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store'),
}));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    // In proxy mode the worker holds every key, so the app is fully configured
    // with no local keys at all.
    proxy: Boolean(config.proxy),
    riotKey: canRiot,
    aiKey: canGroq || canGemini,
    llm: config.proxy ? 'proxy' : config.llm.provider,
    // Where to paste keys — an installed build ships none, and without this
    // the UI can only say "missing" without saying where to fix it.
    envPath: userEnvPath,
    envReport,
  });
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
  if (!canRiot) {
    return res.status(500).json({ error: 'Server has no RIOT_API_KEY set. Add it to .env and restart.' });
  }
  try {
    const result = await analyzePlayer(riotId, region, { lang });
    res.json(result);
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    // Send a CODE, not prose: the server has no idea which of the 13 UI
    // languages the user is reading, so the client renders the message.
    const codes = { 404: 'notFound', 403: 'keyRejected', 429: 'rateLimited' };
    const messages = {
      404: 'Player or matches not found — check the Riot ID and region.',
      403: 'Riot API key was rejected. Dev keys expire every 24h — regenerate it.',
      429: 'Riot rate limit hit. Wait a moment and try again.',
    };
    console.error('[analyze]', e.message);
    res.status(code).json({
      code: codes[code] || null,
      error: messages[code] || e.message || 'Analysis failed',
    });
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
// The language is part of the cache identity: a tip generated while another
// language was selected must never be replayed into a Ukrainian UI.
// `sit` (which enemies are dead) is part of both cache identities: a tip built
// around a respawn window must not outlive that window.
let visionState = { tip: null, ts: 0, lang: 'en', sit: '' };
let textTipState = { data: null, ts: 0, lang: 'en', sit: '' };
let lastSit = ''; // situation at the time the last screenshot was analysed
let lastCoachLang = 'en'; // vision calls happen out-of-band, so remember the UI language

app.get('/api/live-coach', async (req, res) => {
  const bucket = ['low', 'mid', 'high'].includes(req.query.bucket) ? req.query.bucket : 'mid';
  lastCoachLang = req.query.lang || lastCoachLang;
  try {
    // `sit` = who is dead right now, sent by the widget (it polls the game
    // every 5s). Advice built around a respawn window goes stale the moment
    // that window opens or closes, so a cached tip from a different situation
    // must never be replayed — that was the lag on enemy deaths.
    const wantLang = req.query.lang || 'en';
    const sit = String(req.query.sit || '');
    lastSit = sit; // vision runs out-of-band; tag its tips with this situation
    // Someone is dead → the window is short; keep tips fresh instead of cheap.
    const textTtl = sit ? 12000 : 45000;
    const visionTtl = sit ? 20000 : 90000;

    if (visionState.tip && visionState.lang === wantLang && visionState.sit === sit
        && Date.now() - visionState.ts < visionTtl) {
      return res.json({ inGame: true, ready: true, tip: visionState.tip, source: 'vision' });
    }
    if (textTipState.data && textTipState.lang === wantLang && textTipState.sit === sit
        && Date.now() - textTipState.ts < textTtl) {
      return res.json(textTipState.data);
    }
    const out = await liveCoachResponse(bucket, wantLang);
    if (out.ready && out.tip) textTipState = { data: out, ts: Date.now(), lang: wantLang, sit };
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

// Champion list for the build search (names only, from Data Dragon).
app.get('/api/champions', async (req, res) => {
  try {
    const champs = await getChampions();
    res.json({ champions: Object.keys(champs).sort() });
  } catch (e) {
    console.error('[champions]', e.message);
    res.json({ champions: [] });
  }
});

// Build & strategy lookup — same web-grounded engine as the in-game matchup
// brief, but usable any time from the launcher, no live game required.
app.get('/api/build', async (req, res) => {
  const champ = String(req.query.champ || '').slice(0, 40).trim();
  if (!champ) return res.status(400).json({ error: 'champ required' });
  const role = String(req.query.role || '').slice(0, 20).trim() || 'MIDDLE';
  const vs = String(req.query.vs || '').slice(0, 40).trim() || null;
  try {
    res.json(await matchupBrief({ champ, vs, role, lang: req.query.lang || 'en' }));
  } catch (e) {
    console.error('[build]', e.message);
    res.status(500).json({ error: 'build_lookup_failed' });
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
    if (tip) visionState = { tip, ts: Date.now(), lang: lastCoachLang, sit: lastSit };
    res.json({ ok: !!tip });
  } catch (e) {
    if (e.code !== 'NOGAME') console.error('[vision]', e.message);
    res.json({ ok: false });
  }
});

// Bound to 127.0.0.1 on purpose: the default (0.0.0.0) would expose the
// coach — and the Riot/AI keys behind it — to everyone on the local network.
export function startServer(port = config.port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`\n  AI LoL Coach → http://localhost:${port}`);
      console.log(`  Mode: ${config.proxy ? 'proxy (keys on the worker)' : 'direct (local keys)'}`);
      console.log(`  Riot: ${canRiot ? 'ok' : 'MISSING (set PROXY_URL or RIOT_API_KEY)'}  ·  AI: ${canGroq || canGemini ? 'ok' : 'MISSING'}\n`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// Auto-start only when run directly (`npm start`). When Electron imports this
// module it calls startServer() itself, so there is no second process — and
// therefore no console window.
const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) startServer();

export { app };
