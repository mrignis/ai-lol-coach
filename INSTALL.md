# AI LoL Coach — Install

**No API keys needed.** Install and play — analysis, AI coaching, news and the
in-game widget all work out of the box (they go through a hosted server that
holds the keys for you).

## Install

1. Run **`AI LoL Coach Setup.exe`** → Next → Finish.
   Installs per-user, no admin rights required.
2. Launch **AI LoL Coach** from the Start menu (or the desktop shortcut).

That's it. Type your Riot ID (`Name#TAG`), pick your region, hit **Analyze**.

## Using it

- **Home** — analyze your last 20 ranked games; the ★ button saves an account.
- **Builds** — a current-patch build & matchup brief once you're in a game.
- **Live widget** — appears by itself when a match starts. Shows KDA, CS/min,
  vision, objective timers and AI tips. Move it anywhere, 📌 pins it, ⚙ sets
  opacity/size and which panels to show.
- **Tray icon** — click to show/hide the widget; right-click for the menu.
  Closing a window hides the app to the tray; it keeps coaching. **Quit** from
  the tray menu to fully exit.
- **Hotkeys** — `Ctrl+Shift+H` show/hide widget, `Ctrl+Shift+X` click-through.

> 🖥 For the widget to draw over the game, set League to **Borderless**
> (Esc → Options → Video → Window Mode → Borderless). Exclusive Fullscreen
> hides every overlay — that's a Windows limitation.

## What runs where

- The **in-game widget** reads League's local API (`127.0.0.1:2999`) directly —
  no internet, no keys, nothing leaves your PC except optional screenshot tips.
- **Analysis / AI / news** go through the hosted proxy, so you never handle keys.

## Privacy

- Screen capture (for AI vision tips) grabs **only the League window**, never
  your whole desktop, at most once a minute, only while a game is running and
  the widget is visible.
- The local server listens on `127.0.0.1` only — nobody on your network can
  reach it.

## Run your own backend (optional)

Prefer not to rely on the shared server? You can plug in your own keys — see
`.env.example` and `README.md`. Not required for normal use.

---

Ukrainian version: **INSTALL_UA.md**. Not affiliated with Riot Games.
