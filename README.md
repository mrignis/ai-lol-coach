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

## 🔑 API keys — the important part

The app ships with **no keys** (an installer must never carry them), so on the
first run it creates an empty settings file for you and the launcher shows a
banner telling you exactly where it is.

**Where to put the keys**

| How you run it | File to edit |
|---|---|
| Installed app | `%APPDATA%\lol-coach\.env` |
| From source | `.env` in the project folder (copy `.env.example`) |

Paste it into Explorer's address bar to open the folder:

```
%APPDATA%\lol-coach
```

Open `.env` in Notepad and fill in the values below.

### 1. Riot API key — required

Without it the app can't read your matches, rank, or the champion rotation.

1. Go to **https://developer.riotgames.com** and sign in with your Riot account.
2. On the dashboard find **DEVELOPMENT API KEY**.
3. Tick the reCAPTCHA, press **REGENERATE API KEY**.
4. Copy the key (starts with `RGAPI-`) and put it in `.env`:

```env
RIOT_API_KEY=RGAPI-your-key-here
```

> ⚠️ **A development key expires every 24 hours.** You have to regenerate it and
> paste it again each day. To avoid that, apply for a free **Personal API Key**
> on the same site (Register Product → Personal) — it doesn't expire.

### 2. Groq key — required for AI coaching

Free, no card, ~1000 requests/day. This is the main brain.

1. Go to **https://console.groq.com** and sign in (Google works).
2. Left menu → **API Keys** → **Create API Key**.
3. Copy it (starts with `gsk_`) — it's shown only once — and add:

```env
GROQ_API_KEY=gsk_your-key-here
```

### 3. Gemini key — optional, but adds screen vision

Used as an AI fallback **and** for reading your screen during a game (minimap,
enemy positions) and for looking up current-patch builds.

1. Go to **https://aistudio.google.com/apikey** → **Create API key**.
2. Add it:

```env
GEMINI_API_KEY=AIza-your-key-here
```

**Restart the app** after editing `.env`.

### What works without any keys

The in-game widget still runs: live KDA, CS/min, vision, gold, objective
timers and rule-based nudges. That part uses League's **local** Live Client
Data API (`127.0.0.1:2999`) and needs no key and no internet.

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
| Desktop shell, tray, overlay, screen capture | `electron/main.js` |
| UI + 13 languages | `public/` |

Not affiliated with Riot Games.
