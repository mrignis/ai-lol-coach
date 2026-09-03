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
import { getAccount, getRank } from './riot.js';
import { leaderboard, TIERS, DIVISIONS, QUEUES } from './leaderboard.js';

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
    // Report the provider that will actually answer. A local key bypasses the
    // worker, so saying "proxy" here was misleading while OpenAI served every
    // request directly.
    llm: config.llm.openaiKey ? config.llm.provider
      : (config.proxy ? 'proxy' : config.llm.provider),
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

// Ring buffer of tips actually served, so a play-test recorder can see what the
// widget got WITHOUT asking for tips of its own. The first recorder made its
// own calls and so doubled the load against Groq's 8000-tokens-per-minute cap,
// which is what made every tip in that session fall back to a template.
const tipLog = [];
function recordTip(entry) {
  tipLog.push({ at: Date.now(), ...entry });
  if (tipLog.length > 200) tipLog.shift();
}
let lastCoachLang = 'en'; // vision calls happen out-of-band, so remember the UI language
let lastGameTime = 0;     // detects a new game so tip history does not leak across matches
let lastLoggedVisionTs = 0; // one log line per screenshot tip, not per poll that replays it

// Read-only view of tips already served — for diagnostics, costs nothing.
app.get('/api/tips-log', (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json({ tips: tipLog.filter(t => t.at > since) });
});

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
    // `hot` (not the mere presence of `sit`) decides: the signature is always
    // populated now that it also carries the event count.
    const hot = req.query.hot === '1';
    // 36s, not 45s, because the widget asks every 18s: a 45s cache is only
    // spent on the third poll, so a quiet stretch showed the same line for 54s
    // and read as frozen. Two poll intervals exactly caps it at 36s, and costs
    // one extra call per quiet minute rather than a faster poll everywhere.
    const textTtl = hot ? 12000 : 36000;
    // 54s, down from 90s. This check runs FIRST and returns early, so a fresh
    // screenshot tip suppressed text tips for a minute and a half — which is
    // what actually made the widget look frozen. Trimming textTtl alone did
    // nothing, because this cache sits in front of it.
    const visionTtl = hot ? 20000 : 54000;

    if (visionState.tip && visionState.lang === wantLang && visionState.sit === sit
        && Date.now() - visionState.ts < visionTtl) {
      // Recorded so a play-test sees what was actually ON SCREEN. This path
      // used to return without logging, so every recording showed only the
      // text tips and made the gaps between them look like the whole story.
      if (visionState.ts !== lastLoggedVisionTs) {
        lastLoggedVisionTs = visionState.ts;
        recordTip({ source: 'vision', tip: visionState.tip, sit, hot });
      }
      return res.json({ inGame: true, ready: true, tip: visionState.tip, source: 'vision' });
    }
    if (textTipState.data && textTipState.lang === wantLang && textTipState.sit === sit
        && Date.now() - textTipState.ts < textTtl) {
      return res.json(textTipState.data);
    }
    // Hand the model what it just said: without it the coach circled the same
    // theme all game ("clear vision near Baron" four times in one match).
    const withTips = tipLog.filter(t => t.tip);
    const recentTips = withTips.slice(-3).map(t => t.tip);
    // The purchase-order guard gets the WHOLE game, not a window. A twenty-tip
    // window still let Null-Magic Mantle through eight times in one match: the
    // asks arrived in pairs minutes apart (3:42 + 6:02, then 17:53 + 18:23,
    // then 26:14 + 27:09), and each pair scrolled out before the next, so the
    // count reset to zero every time. "They already refused this" is a fact
    // about the game, not about the last few minutes.
    const tipHistory = withTips.map(t => t.tip);
    // Stamped when the request STARTS, not when the model answers. Generation
    // takes 5-20s, and charging that to the cache pushed the effective gap past
    // the next 18s poll: a 36s cache plus 18s of latency expires at 54s, which
    // is exactly the 50-60s tail a recorded game showed while the 36s cache was
    // working perfectly for every fast response.
    const startedAt = Date.now();
    const out = await liveCoachResponse(bucket, wantLang, recentTips, tipHistory);
    // A clock that went backwards means a new game: the previous match's advice
    // must not suppress items in this one.
    if (out.gameTimeSec != null) {
      if (out.gameTimeSec + 60 < lastGameTime) tipLog.length = 0;
      lastGameTime = out.gameTimeSec;
    }
    if (out.ready && out.tip) textTipState = { data: out, ts: startedAt, lang: wantLang, sit };
    if (out.ready) recordTip({ source: out.source, why: out.why, tip: out.tip, code: out.code, sit, hot });
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

// Top of the ladder for one region/tier/queue.
app.get('/api/leaderboard', async (req, res) => {
  const platform = PLATFORMS.some(p => p.id === req.query.region) ? req.query.region : 'na1';
  const tier = TIERS.includes(req.query.tier) ? req.query.tier : 'challenger';
  const queue = QUEUES[req.query.queue] ? req.query.queue : 'solo';
  const division = DIVISIONS.includes(req.query.division) ? req.query.division : 'I';
  if (!canRiot) return res.status(500).json({ error: 'no_riot_key' });
  try {
    res.json(await leaderboard(platform, tier, queue, division));
  } catch (e) {
    console.error('[leaderboard]', e.message);
    res.status(e.code === 429 ? 429 : 500).json({ error: 'leaderboard_failed' });
  }
});

// One player's own standing — the ladder below Master is a single page out of
// hundreds of thousands, so "where am I" cannot be answered by scanning it.
app.get('/api/myrank', async (req, res) => {
  const platform = PLATFORMS.some(p => p.id === req.query.region) ? req.query.region : 'na1';
  const riotId = String(req.query.riotId || '').trim();
  if (!riotId.includes('#')) return res.status(400).json({ error: 'bad_riot_id' });
  try {
    const [gameName, tagLine] = riotId.split('#');
    const acct = await getAccount(gameName.trim(), tagLine.trim(), platform);
    res.json({ riotId, rank: await getRank(acct.puuid, platform) });
  } catch (e) {
    if (e.code === 404) return res.status(404).json({ error: 'not_found' });
    console.error('[myrank]', e.message);
    res.status(500).json({ error: 'myrank_failed' });
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
