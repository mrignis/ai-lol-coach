# AI LoL Coach

A desktop coach for League of Legends that knows **you**, not just the game.

It reads your last 20 ranked games through the official Riot API, works out the
3 things *you personally* should fix, and — while you play — shows a small
overlay with live nudges and AI advice based on the actual state of the match.

- 🖥 **One app**: launcher window + in-game overlay, lives in the system tray
- 🎯 **Post-game analysis**: your metrics vs benchmarks for your role and rank
- ⚡ **In-game widget**: CS/vision/deaths pace, objective timers, AI tips
- 📈 **Progress memory**: compares sessions so the coach stops repeating itself
- 🌍 **13 languages**, including Ukrainian, and the AI answers in your language

---

## Install

**Option A — installer (recommended)**

1. Download / build `AI LoL Coach Setup 0.1.0.exe` (see *Build* below).
2. Run it. The app installs per-user (no admin rights needed).
3. Launch **AI LoL Coach** from the Start menu.

**Option B — from source**

```bash
git clone https://github.com/mrignis/ai-lol-coach
cd ai-lol-coach
npm install
npm start
```

---

## 🔑 API keys

**Installed app: none needed.** The installer talks to a hosted Cloudflare
Worker that holds the Riot / Groq / Gemini keys, so analysis, AI coaching, news
and the widget all work out of the box. See **INSTALL.md** (or **INSTALL_UA.md**).

You only touch keys if you run your own backend — two ways:

**A. Your own keys directly** (from source, or override the installed app).
Edit the `.env`:

| How you run it | File |
|---|---|
| Installed app | `%APPDATA%\lol-coach\.env` |
| From source | `.env` in the project folder (copy `.env.example`) |

- `RIOT_API_KEY` — https://developer.riotgames.com (dev key expires every 24h;
  a free **Personal API Key** doesn't).
- `GROQ_API_KEY` — https://console.groq.com (free, ~1000/day, the main brain).
- `GEMINI_API_KEY` — https://aistudio.google.com/apikey (fallback + screen
  vision + build lookups).

Restart the app after editing `.env`.

**B. Your own proxy** (hide keys behind your own worker — how the shipped build
works). Deploy `worker/`:

```bash
cd worker
wrangler secret put APP_TOKEN        # shared token the app sends
wrangler secret put RIOT_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler deploy
```

Then set `PROXY_URL` + `PROXY_TOKEN` in the app's `.env` (or bundle them via
`build-config/proxy.env`, gitignored). The worker restricts Riot to a path
allowlist, requires the app token, and rate-limits per IP — so the raw keys
never leave Cloudflare and the repo stays key-free.

> The in-game widget needs **no key at all** either way — it reads League's
> local Live Client Data API (`127.0.0.1:2999`).

---

## Using it

- **Launcher window** — type your Riot ID (`Name#TAG`), pick your region, press
  Analyze. Star ★ saves the account for next time.
- **Widget** — appears by itself when a game starts. Gear ⚙ sets opacity, size
  and which panels to show; 📌 pins it in place.
- **Tray icon** — click to show/hide the widget; right-click for the menu.
  Closing a window hides the app to the tray, it keeps coaching. Use **Quit**
  in the tray menu to actually exit.
- **Hotkeys** — `Ctrl+Shift+H` show/hide the widget, `Ctrl+Shift+X` click-through.

> The overlay can only draw over the game in **Borderless / Windowed** mode.
> Exclusive Fullscreen takes over the display and hides every other window —
> that's a Windows limitation, not a bug.

---

## Privacy & security

- **Screen capture**: only the **League window** is ever captured — never your
  whole desktop. If the game window isn't found, nothing is sent at all.
  Frames go to Gemini only while a game is running and the widget is visible,
  at most once a minute, and only if the picture actually changed.
- **Local server**: bound to `127.0.0.1`, so nobody else on your network can
  reach it or your keys.
- **Keys**: stay in your own `.env`, are never bundled into the installer, and
  never reach the browser/renderer.
- **Riot ToS**: analysis and nudges only. Read-only official APIs, no memory
  reading, no injection, no automation — it advises, it never plays for you.

---

## Build

```bash
npm run icon    # regenerate build/icon.png
npm run dist    # -> dist/AI LoL Coach Setup 0.1.0.exe
```

## Tuning

- `server/benchmarks.js` — the per-role, per-tier targets the whole weakness
  engine compares you against. Edit numbers, restart, re-analyze.
- `npm run probe -- "Name#TAG" na1` — prints the raw pipeline without any UI.

## How it fits together

| Piece | File |
|---|---|
| Riot client (Account-V1 → League-V4 → Match-V5) | `server/riot.js` |
| Weakness engine (metrics → gaps → top 3) | `server/engine.js` |
| Benchmarks | `server/benchmarks.js` |
| In-game state, nudges, phases | `server/live.js` |
| AI providers + prompts (Groq → Gemini → template) | `server/llm.js` |
| Upstream router (proxy vs direct keys) | `server/upstream.js` |
| Key-hiding proxy (Cloudflare Worker) | `worker/worker.js` |
| Desktop shell, tray, overlay, screen capture | `electron/main.js` |
| UI + 13 languages | `public/` |

Not affiliated with Riot Games.
