import { app, BrowserWindow, globalShortcut } from 'electron';
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
    width: 340,
    height: 480,
    x: 40,
    y: 70,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    fullscreenable: false,
    minWidth: 260,
    minHeight: 220,
    webPreferences: { contextIsolation: true },
  });
  // Float above the game (works when League runs Borderless/Windowed).
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(OVERLAY_URL);
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
