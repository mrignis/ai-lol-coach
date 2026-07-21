import { app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen, shell, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from '../server/index.js';

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
let win = null;      // transparent in-game overlay
let coachWin = null; // post-game analysis window
let tray = null;
let clickThrough = false;
let isQuitting = false;

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
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    fullscreenable: false,
    minWidth: 220,
    minHeight: 130,
    webPreferences: SAFE_WEB_PREFS,
  });
  // Float above the game (works when League runs Borderless/Windowed).
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

  // When the game window is focused it can jump above ours, so keep
  // re-asserting top position (without stealing focus from the game).
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (!clickThrough) win.moveTop();
  }, 1500);
}

async function openCoach() {
  await ensureServer();
  if (alive(coachWin)) { coachWin.show(); coachWin.focus(); return; }
  coachWin = new BrowserWindow({
    width: 900, height: 900, icon: ICON, title: 'AI LoL Coach',
    backgroundColor: '#0a0e14', webPreferences: SAFE_WEB_PREFS,
  });
  coachWin.setMenuBarVisibility(false);
  coachWin.loadURL(COACH_URL);
  coachWin.on('closed', () => { coachWin = null; });
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
    await fetch(`http://localhost:${PORT}/api/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: resized.toJPEG(55).toString('base64'),
        minimap: minimap.toJPEG(75).toString('base64'),
      }),
    });
  } catch { /* vision is best-effort; the text-only tip still works */ }
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

function toggleWidget() {
  const w = ensureWindow();
  if (alive(w) && w.isVisible()) {
    w.hide();
  } else {
    // Always restore in an interactive state: a widget that comes back
    // click-through looks visible but ignores every click.
    clickThrough = false;
    w.setIgnoreMouseEvents(false);
    w.show();
    w.setAlwaysOnTop(true, 'screen-saver');
  }
  updateTrayMenu();
}

// ── tray ──────────────────────────────────────────────────────────────
function updateTrayMenu() {
  if (!tray) return;
  const shown = alive(win) && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: shown ? 'Hide widget' : 'Show widget', click: toggleWidget },
    { label: clickThrough ? 'Click-through: ON' : 'Click-through: OFF', click: toggleClickThrough },
    { type: 'separator' },
    { label: 'Open coach (analysis)', click: openCoach },
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
    fs.appendFileSync(path.join(app.getPath('userData'), 'main.log'),
      `[${new Date().toISOString()}] ${msg}\n`);
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

app.whenReady().then(async () => {
  await ensureServer();
  createWindow();
  createTray();
  setInterval(visionLoop, 60000);
  setTimeout(visionLoop, 8000); // first look shortly after launch, not a minute later
  globalShortcut.register('Control+Shift+X', toggleClickThrough);
  globalShortcut.register('Control+Shift+H', toggleWidget);
});

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
// Tray app: closing every window must NOT quit.
app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (httpServer) { try { httpServer.close(); } catch { /* ignore */ } }
});
