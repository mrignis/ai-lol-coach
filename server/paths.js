import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// In an installed build the code runs from a read-only app.asar under
// Program Files, so anything we write must live in the user's own folder.
// A dev checkout keeps using the project directory (both are gitignored).
const packaged = HERE.includes('app.asar');

export const DATA_ROOT = process.env.LOLCOACH_DATA_DIR
  || (packaged && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'lol-coach')
    : path.join(HERE, '..'));

// NOT "cache"/"data": in a packaged build DATA_ROOT is also Electron's
// userData, where Chromium keeps its own cache under those names and holds
// the files locked. Sharing them made our cache unreadable/unclearable.
export const cacheDir = path.join(DATA_ROOT, packaged ? 'coach-cache' : 'cache');
export const dataDir = path.join(DATA_ROOT, packaged ? 'coach-history' : 'data');
