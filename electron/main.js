import { app, BrowserWindow, globalShortcut, desktopCapturer } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3000;
const OVERLAY_URL = `http://localhost:${PORT}/live.html?overlay=1`;

// ── ensure the coach server is running ────────────────────────────────
function portOpen(port) {
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 800);
  });
}
async function waitForPort(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await portOpen(port)) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

let serverProc = null;
async function ensureServer() {
  if (await portOpen(PORT)) return;
  serverProc = spawn('node', ['server/index.js'], { cwd: ROOT, shell: true, stdio: 'ignore', windowsHide: true });
  await waitForPort(PORT);
}

// ── overlay window ────────────────────────────────────────────────────
let win = null;
let clickThrough = false;

function createWindow() {
  win = new BrowserWindow({
    width: 290,
    height: 340,
    x: 24,
    y: 60,
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
    webPreferences: { contextIsolation: true },
  });
  // Float above the game (works when League runs Borderless/Windowed).
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(OVERLAY_URL);

  // When the game window is focused it can jump above ours, so keep
  // re-asserting top position (without stealing focus from the game).
  setInterval(() => {
    if (win && !win.isDestroyed() && win.isVisible() && !clickThrough) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    } else if (win && !win.isDestroyed() && win.isVisible()) {
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 1500);
}

// ── vision loop: let the AI SEE the screen (minimap, positions) ───────
// Passive screen-reading only, and only while a game is actually running
// and the overlay is visible. One frame a minute keeps us far inside the
// Gemini free tier (a 30-min game ≈ 30 calls).
async function visionLoop() {
  try {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const live = await (await fetch(`http://localhost:${PORT}/api/live`)).json();
    if (!live.inGame || !live.ready) return;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 800 },
    });
    const shot = sources[0]?.thumbnail;
    if (!shot || shot.isEmpty()) return;
    await fetch(`http://localhost:${PORT}/api/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: shot.toJPEG(60).toString('base64') }),
    });
  } catch { /* vision is best-effort; the text-only tip still works */ }
}

// Ctrl+Shift+X → let clicks pass through to the game (and back).
function toggleClickThrough() {
  if (!win) return;
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
}

app.whenReady().then(async () => {
  await ensureServer();
  createWindow();
  setInterval(visionLoop, 60000);
  setTimeout(visionLoop, 8000); // first look shortly after launch, not a minute later
  globalShortcut.register('Control+Shift+X', toggleClickThrough);       // click-through on/off
  globalShortcut.register('Control+Shift+H', () => {                      // hide/show overlay
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (serverProc) { try { serverProc.kill(); } catch { /* ignore */ } }
});
