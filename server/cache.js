import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Match data is immutable once a game ends, so we cache it forever on disk.
// This keeps re-analyzing the same player during testing off the rate limit.
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cache');
let ready = false;

async function ensure() {
  if (!ready) {
    await fs.mkdir(dir, { recursive: true });
    ready = true;
  }
}

const safe = k => String(k).replace(/[^a-zA-Z0-9_.-]/g, '_');

export async function get(key) {
  try {
    await ensure();
    const file = path.join(dir, safe(key) + '.json');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function set(key, value) {
  await ensure();
  const file = path.join(dir, safe(key) + '.json');
  await fs.writeFile(file, JSON.stringify(value));
}
