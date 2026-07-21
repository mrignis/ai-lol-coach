// Generates build/icon.png (app + tray icon) with no image dependencies:
// we rasterise a few shapes into RGBA and hand-encode a PNG.
// Run: node scripts/make-icon.js
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 256;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const BG = [19, 26, 36];      // panel dark
const GOLD = [200, 170, 110]; // LoL gold
const px = Buffer.alloc(S * S * 4); // RGBA

const set = (x, y, [r, g, b], a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const na = a / 255, ia = 1 - na;
  px[i] = px[i] * ia + r * na;
  px[i + 1] = px[i + 1] * ia + g * na;
  px[i + 2] = px[i + 2] * ia + b * na;
  px[i + 3] = Math.max(px[i + 3], a);
};

// Rounded-square background.
const R = 52;
const inRounded = (x, y) => {
  const cx = Math.min(Math.max(x, R), S - 1 - R);
  const cy = Math.min(Math.max(y, R), S - 1 - R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
};
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) if (inRounded(x, y)) set(x, y, BG);
}

// Gold chevron pointing up — "improve". Drawn as a thick polyline.
const stroke = 26;
function line(x1, y1, x2, y2) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1)) * 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x1 + (x2 - x1) * t;
    const cy = y1 + (y2 - y1) * t;
    const r = stroke / 2;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r) set(Math.round(cx + dx), Math.round(cy + dy), GOLD, d > r - 1.5 ? 140 : 255);
      }
    }
  }
}
line(64, 150, 128, 86);
line(128, 86, 192, 150);
line(64, 196, 128, 132);
line(128, 132, 192, 196);

// ── PNG encoding ──
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // colour type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log('wrote', OUT, png.length, 'bytes');
