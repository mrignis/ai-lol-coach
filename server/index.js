import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, PLATFORMS } from './config.js';
import { analyzePlayer } from './analyze.js';

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

app.post('/api/analyze', async (req, res) => {
  const { riotId, region } = req.body || {};
  if (!riotId || !region) {
    return res.status(400).json({ error: 'riotId and region are required' });
  }
  if (!config.riotKey) {
    return res.status(500).json({ error: 'Server has no RIOT_API_KEY set. Add it to .env and restart.' });
  }
  try {
    const result = await analyzePlayer(riotId, region);
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

app.listen(config.port, () => {
  console.log(`\n  AI LoL Coach → http://localhost:${config.port}`);
  console.log(`  Riot key: ${config.riotKey ? 'set' : 'MISSING (add RIOT_API_KEY to .env)'}`);
  console.log(`  LLM provider: ${config.llm.provider}\n`);
});
