import { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen, shell, nativeImage, session } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer, app as expressApp } from '../server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3000;
const OVERLAY_URL = `http://localhost:${PORT}/live.html?overlay=1`;
const COACH_URL = `http://localhost:${PORT}/`;
const ICON = path.join(ROOT, 'build', 'icon.png');

// One instance only: a second launch just reveals the running widget instead
// of fighting over port 3000.
if (!app.requestSingleInstanceLock()) app.quit();

let httpServer = null;
let win = null;         // transparent in-game overlay
let launcherWin = null; // main app window (hub: analysis + widget control)
let tray = null;
let clickThrough = false;
let isQuitting = false;
let autoShown = false;  // overlay was raised by game detection, not by hand

// ── remember where the user parked the widget (pin feature) ───────────
const boundsFile = () => path.join(app.getPath('userData'), 'overlay-bounds.json');

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
    // Clamp to the nearest display so a monitor change can't strand the
    // widget off-screen where the user could never grab it again.
    const wa = screen.getDisplayMatching(b).workArea;
    return {
      width: Math.min(b.width, wa.width),
      height: Math.min(b.height, wa.height),
      x: Math.min(Math.max(b.x, wa.x), wa.x + wa.width - 120),
      y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - 80),
    };
  } catch { return null; }
}

let saveTimer = null;
function saveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds())); } catch { /* best-effort */ }
  }, 400);
}

// Renderer runs only our own local pages and needs no Node access, so lock it
// down: no node integration, isolated context, sandboxed.
const SAFE_WEB_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
};

// ── overlay window ────────────────────────────────────────────────────
function createWindow() {
  const saved = loadBounds();
  win = new BrowserWindow({
    width: saved?.width ?? 290,
    height: saved?.height ?? 340,
    x: saved?.x ?? 24,
    y: saved?.y ?? 60,
    icon: ICON,
    show: false, // the launcher is what greets you; this appears for a game
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    // focusable:false — hovering/clicking the widget must NOT pull focus off
    // League. This is what made the game feel like it "switched" to the overlay.
    focusable: false,
    acceptFirstMouse: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    minWidth: 220,
    minHeight: 130,
    webPreferences: SAFE_WEB_PREFS,
  });
  // Float above the game (works when League runs Borderless/Windowed).
  // 'screen-saver' is required: League in Borderless is itself a topmost
  // window, and the lower 'floating' level left the widget behind the game.
  // Focus is handled by focusable:false + showInactive() (never moveTop()),
  // so the high z-order costs us nothing.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Those two calls can flip the window back to "visible" internally, which
  // desynced the launcher's Show/Hide button. Pin the documented start state.
  win.hide();
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  // Closing hides to tray — the app keeps coaching until Quit is chosen.
  win.on('close', e => {
    if (isQuitting) return;
    e.preventDefault();
    win.hide();
    updateTrayMenu();
    logLine('widget hidden to tray');
  });
  win.loadURL(OVERLAY_URL);

  // Re-assert always-on-top periodically (some apps steal the top slot), but
  // do NOT call moveTop() — moveTop activates the window and stole focus from
  // the game every 1.5s. setAlwaysOnTop alone keeps us above without focusing.
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
  }, 2000);
}

// The launcher is the app's home window: analysis, news and widget controls.
// This is what opens on start — the overlay only appears for a game.
async function openLauncher() {
  await ensureServer();
  if (alive(launcherWin)) { launcherWin.show(); launcherWin.focus(); return; }
  launcherWin = new BrowserWindow({
    width: 960, height: 900, minWidth: 420, minHeight: 500,
    icon: ICON, title: 'AI LoL Coach',
    // Shown immediately: backgroundColor already prevents a white flash, and
    // waiting on ready-to-show risks a launcher that never appears at all.
    backgroundColor: '#0a0e14',
    webPreferences: SAFE_WEB_PREFS,
  });
  launcherWin.setMenuBarVisibility(false);
  launcherWin.webContents.on('did-fail-load', (_e, code, desc, url) =>
    logLine(`launcher failed to load ${url}: ${code} ${desc}`));
  launcherWin.loadURL(COACH_URL);
  logLine('launcher opened');
  // Closing the launcher keeps the app coaching from the tray.
  launcherWin.on('close', e => {
    if (isQuitting) return;
    e.preventDefault();
    launcherWin.hide();
    updateTrayMenu();
  });
}

// ── auto-show the overlay when a game starts ──────────────────────────
// Launcher behaviour: you open the app once, it waits, and the widget
// appears by itself for the match — then steps out of the way afterwards.
let wasInGame = false;
let notInGameStreak = 0;
// The Live Client Data API drops to "no game" on any transient hiccup mid-match
// (a brief hang, the loading/reconnect moment). Hiding on a single reading made
// the widget "close itself" during a game. Require several misses in a row so
// only a real game-end retracts it.
const END_CONFIRM = 4; // × ~8s ≈ 30s of no game before we hide

async function gameWatch() {
  try {
    const live = await (await fetch(`http://localhost:${PORT}/api/live`)).json();
    const inGame = !!live.inGame;
    if (inGame) {
      notInGameStreak = 0;
      if (!wasInGame) {
        logLine('game detected → showing widget');
        const w = ensureWindow();
        if (!w.isVisible()) { autoShown = true; showWidget(); }
        wasInGame = true;
      }
    } else if (wasInGame) {
      notInGameStreak++;
      if (notInGameStreak >= END_CONFIRM) {
        logLine(`game ended (confirmed ${notInGameStreak}×)`);
        // Only retract what we raised: never hide a widget the user opened.
        if (autoShown && alive(win) && win.isVisible()) { win.hide(); updateTrayMenu(); }
        autoShown = false;
        wasInGame = false;
        notInGameStreak = 0;
      }
    }
  } catch { /* server not up yet — leave the widget as it is */ }
}

// ── controls exposed to the launcher page ─────────────────────────────
// Registered on the in-process Express app, so the sandboxed renderer needs
// no Node access or preload bridge to drive the window.
function registerAppRoutes() {
  expressApp.get('/api/app/status', (req, res) => {
    res.json({
      desktop: true,
      widgetVisible: alive(win) && win.isVisible(),
      clickThrough,
      inGame: wasInGame,
    });
  });
  expressApp.post('/api/app/widget', (req, res) => {
    const action = String(req.body?.action || 'toggle');
    if (action === 'show') { autoShown = false; showWidget(); }
    else if (action === 'hide') { if (alive(win)) win.hide(); updateTrayMenu(); }
    else toggleWidget();
    res.json({ widgetVisible: alive(win) && win.isVisible() });
  });
}

// ── vision: capture ONLY the League window ────────────────────────────
// Privacy rule — never grab the whole desktop. If the game window isn't
// found we send nothing, so a minimised game can't leak a banking tab or
// a messenger into the AI request.
const GAME_WINDOW = /league of legends/i;

let lastFrameSig = null;
// Cheap perceptual signature: 32x32 grayscale means. Lets us skip the AI call
// when the screen barely changed (recall screen, shop open, AFK) — fewer
// requests, less quota burn, less CPU during the game.
function frameSignature(img) {
  const small = img.resize({ width: 32, height: 32, quality: 'good' });
  const bmp = small.toBitmap(); // BGRA
  const sig = new Uint8Array(32 * 32);
  for (let i = 0, p = 0; p < sig.length; i += 4, p++) {
    sig[p] = (bmp[i] * 0.114 + bmp[i + 1] * 0.587 + bmp[i + 2] * 0.299) | 0;
  }
  return sig;
}
function changedEnough(sig) {
  if (!lastFrameSig) return true;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - lastFrameSig[i]);
  return diff / sig.length > 6; // mean abs difference out of 255
}

async function visionLoop() {
  try {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const live = await (await fetch(`http://localhost:${PORT}/api/live`)).json();
    if (!live.inGame || !live.ready) return;

    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1200 },
    });
    const game = sources.find(s => GAME_WINDOW.test(s.name || ''));
    if (!game) return; // game window not visible → capture nothing at all
    const shot = game.thumbnail;
    if (!shot || shot.isEmpty()) return;

    const sig = frameSignature(shot);
    if (!changedEnough(sig)) return; // near-identical frame, skip the API call
    lastFrameSig = sig;

    // Minimap lives in the bottom-right corner (default HUD). Send it as a
    // second zoomed image — in the full frame it's too small for the model.
    const { width, height } = shot.getSize();
    const minimap = shot.crop({
      x: Math.round(width * 0.72),
      y: Math.round(height * 0.60),
      width: Math.round(width * 0.28),
      height: Math.round(height * 0.40),
    });
    const resized = shot.resize({ width: 1280 });
    const res = await fetch(`http://localhost:${PORT}/api/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: resized.toJPEG(55).toString('base64'),
        minimap: minimap.toJPEG(75).toString('base64'),
      }),
    });
    // Screenshot tips run on Gemini, whose free quota is exhausted for days at
    // a time. Retrying every minute regardless meant capturing a 1280px frame,
    // JPEG-encoding it twice and shipping ~200KB — all discarded — during a
    // game, which is exactly when the CPU is worth protecting. Back off after
    // repeated refusals and recover the moment one succeeds.
    const ok = res.ok && (await res.json().catch(() => ({}))).ok;
    visionMisses = ok ? 0 : Math.min(visionMisses + 1, VISION_BACKOFF.length - 1);
  } catch {
    visionMisses = Math.min(visionMisses + 1, VISION_BACKOFF.length - 1);
  }
}

// How many capture cycles to skip after N consecutive failures: none, none,
// then one, three, nine. At the 60s tick that is a retry every ten minutes
// while the provider stays down, instead of sixty wasted captures an hour.
const VISION_BACKOFF = [0, 0, 1, 3, 9];
let visionMisses = 0;
let visionSkips = 0;

function visionTick() {
  if (visionSkips > 0) { visionSkips--; return; }
  visionSkips = VISION_BACKOFF[visionMisses];
  return visionLoop();
}

const alive = w => w && !w.isDestroyed();

// The widget must always be recoverable from the tray. If the window was
// destroyed for any reason, rebuild it rather than leaving a dead tray icon
// the user can click forever with nothing happening.
function ensureWindow() {
  if (!alive(win)) createWindow();
  return win;
}

// Ctrl+Shift+X → let clicks pass through to the game (and back).
function toggleClickThrough() {
  if (!alive(win)) return;
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  updateTrayMenu();
}

// Always restore in an interactive state: a widget that comes back
// click-through looks visible but ignores every click.
function showWidget() {
  const w = ensureWindow();
  clickThrough = false;
  w.setIgnoreMouseEvents(false);
  // showInactive, not show: bring the widget up WITHOUT focusing it, so League
  // keeps input focus even the moment the overlay appears.
  w.showInactive();
  w.setAlwaysOnTop(true, 'screen-saver');
  updateTrayMenu();
}

function toggleWidget() {
  const w = ensureWindow();
  if (alive(w) && w.isVisible()) { w.hide(); autoShown = false; updateTrayMenu(); }
  else showWidget();
}

// ── tray ──────────────────────────────────────────────────────────────
function updateTrayMenu() {
  if (!tray) return;
  const shown = alive(win) && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open AI LoL Coach', click: openLauncher },
    { type: 'separator' },
    { label: shown ? 'Hide widget' : 'Show widget', click: toggleWidget },
    { label: clickThrough ? 'Click-through: ON' : 'Click-through: OFF', click: toggleClickThrough },
    { type: 'separator' },
    { label: 'Open in browser', click: () => shell.openExternal(COACH_URL) },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('AI LoL Coach — click to show/hide the widget');
  tray.on('click', toggleWidget);
  tray.on('double-click', toggleWidget);
  updateTrayMenu();
}

// There is no console to print to, so failures go to a log file the user
// (and we) can read: %APPDATA%/AI LoL Coach/main.log
function logLine(msg) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true }); // may not exist on a fresh install
    fs.appendFileSync(path.join(dir, 'main.log'), `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* logging must never break the app */ }
}
process.on('uncaughtException', e => logLine('uncaughtException: ' + (e?.stack || e)));
process.on('unhandledRejection', e => logLine('unhandledRejection: ' + (e?.stack || e)));

// Express runs inside this process: no child process, no console window.
// Re-checked before work that needs it, so a dead socket self-heals instead
// of leaving a running tray icon backed by nothing.
async function ensureServer() {
  if (httpServer && httpServer.listening) return;
  try {
    httpServer = await startServer(PORT);
    logLine('server listening on 127.0.0.1:' + PORT);
  } catch (e) {
    httpServer = null;
    if (e?.code !== 'EADDRINUSE') logLine('startServer failed: ' + (e?.stack || e));
  }
}

// An installed build ships no keys (they must never travel inside an
// installer). Drop an editable template next to the user's config on first
// run so there is an obvious file to paste keys into.
function ensureUserEnv() {
  try {
    const dir = path.join(app.getPath('appData'), 'lol-coach');
    const target = path.join(dir, '.env');
    if (fs.existsSync(target)) return target;
    const template = app.isPackaged
      ? path.join(process.resourcesPath, '.env.example')
      : path.join(ROOT, '.env.example');
    if (!fs.existsSync(template)) return target;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(template, target);
    logLine('created key template at ' + target);
    return target;
  } catch (e) {
    logLine('ensureUserEnv failed: ' + (e?.message || e));
    return null;
  }
}

// Wipe the renderer cache on every start. Keying this on app.getVersion()
// wasn't enough: rebuilding the same version number left the previous build's
// HTML/JS cached, so the window showed a stale UI against a fresh server.
// The pages come off our own localhost — caching them buys nothing.
async function clearRendererCache() {
  try {
    await session.defaultSession.clearCache();
    logLine('renderer cache cleared');
  } catch (e) {
    logLine('clearRendererCache failed: ' + (e?.message || e));
  }
}

app.whenReady().then(async () => {
  ensureUserEnv();
  await clearRendererCache();
  registerAppRoutes();
  await ensureServer();
  createWindow();   // built hidden; the game (or the user) raises it
  createTray();
  await openLauncher();
  setInterval(gameWatch, 8000);
  setTimeout(gameWatch, 2000);
  setInterval(visionTick, 60000);
  setTimeout(visionTick, 8000); // first look shortly after launch, not a minute later
  globalShortcut.register('Control+Shift+X', toggleClickThrough);
  globalShortcut.register('Control+Shift+H', toggleWidget);
});

// Launching again (or clicking the shortcut) reopens the launcher.
app.on('second-instance', openLauncher);
app.on('activate', openLauncher);
// Tray app: closing every window must NOT quit.
app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (httpServer) { try { httpServer.close(); } catch { /* ignore */ } }
});
