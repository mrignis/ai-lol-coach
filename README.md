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
- `LLM_PROVIDER` — `ollama` (default, free), `groq`, `anthropic`, or `none`.
  - **ollama**: start your local Ollama (`ollama serve`, signed in) — the backend calls
    `qwen3-coder:480b-cloud` at `localhost:11434`. If it's down, the app still works and
    generates coaching from a local template.
  - **groq / anthropic**: paste the matching key.

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
API routes to a serverless function. If you deploy, the `ollama` provider won't be
reachable — switch `LLM_PROVIDER` to `groq` or `anthropic` for the hosted build.
