# AI LoL Coach — MVP v0.1

Reads your last 20 ranked games via the **official Riot API**, finds *your* recurring
weaknesses (not generic tier-list advice), and explains the 3 things you personally
should fix to win more.

## Setup

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Then edit `.env`:

- `RIOT_API_KEY` — get one at https://developer.riotgames.com (dev keys expire every 24h).
- `GROQ_API_KEY` — free at https://console.groq.com (1000 req/day). Primary AI
  (`openai/gpt-oss-120b`), answers in under a second.
- `GEMINI_API_KEY` — free at https://aistudio.google.com. Text fallback and the
  vision provider (in-game screenshot analysis).
- `LLM_PROVIDER` — `groq` (default), `gemini`, or `none`. The server automatically
  falls back groq → gemini → localized template, so a capped free tier never
  silences the coach.

## Prove the data pipeline (no UI)

```bash
npm run probe -- "Faker#KR1" kr
```

Prints the 20 games' stats, aggregate metrics, and your worst gaps.
Platforms: `na1 euw1 eun1 kr br1 jp1 la1 la2 oc1 tr1 ru`.

## Run the app

```bash
npm start
# → http://localhost:3000
```

Type your Riot ID (`Name#TAG`), pick your region, hit **Analyze**.

## How it works

- `server/riot.js` — Riot API client (Account-V1 → League-V4 → Match-V5), disk-cached
  per match, 429 back-off, light throttle.
- `server/benchmarks.js` — **the one file you tune.** Per-role, per-tier targets.
- `server/engine.js` — averages your metrics, ranks the gaps vs your rank's benchmark,
  takes the worst 3.
- `server/llm.js` — sends those 3 gaps + your numbers to the LLM in a coaching prompt.
- `public/` — the UI.

## Tuning benchmarks

Everything the gap engine compares against lives in `BENCHMARKS` in
`server/benchmarks.js`. Edit the numbers, restart, re-analyze — no other changes needed.

## Notes / limits (v0.1)

- **Role-mixing**: metrics are averaged across every role you queued and compared to your
  *main* role's benchmark. Flagged in the UI. Segmenting by role is a v0.2 job
  (see the `NOTE` in `engine.js`).
- Riot ToS: analysis & post-game coaching only. No overlays, no live-game decisions.

## Deploy later

Backend + static frontend. Deployable to any Node host (Render/Railway/Fly) or adapt the
API routes to a serverless function. Both AI providers (Groq, Gemini) are cloud APIs,
so the hosted build works unchanged — just set the same env vars.
