/**
 * Generates public/icons/{16,32,48,128}.png locally (no network, no image deps).
 * A rounded square with a map-pin glyph. Run once via `pnpm icons`; output is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const BG: [number, number, number] = [79, 70, 229]; // indigo
const FG: [number, number, number] = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Coverage of pixel (x, y) in [0,1] for the icon shape, 4×4 supersampled. */
function sample(size: number, x: number, y: number): { bg: number; fg: number } {
  let bg = 0;
  let fg = 0;
  const steps = 4;
  for (let sy = 0; sy < steps; sy++) {
    for (let sx = 0; sx < steps; sx++) {
      const u = (x + (sx + 0.5) / steps) / size; // 0..1
      const v = (y + (sy + 0.5) / steps) / size;
      // Rounded square background, corner radius 22%.
      const r = 0.22;
      const dx = Math.max(r - u, 0, u - (1 - r));
      const dy = Math.max(r - v, 0, v - (1 - r));
      if (dx * dx + dy * dy > r * r) continue;
      bg++;
      // Pin: circle head + tapered tail, hollow centre.
      const hx = u - 0.5;
      const hy = v - 0.42;
      const headD = Math.hypot(hx, hy);
      const inHead = headD < 0.22 && headD > 0.09;
      const t = (v - 0.5) / 0.32; // tail from v=0.5 to v=0.82
      const inTail = t >= 0 && t <= 1 && Math.abs(hx) < 0.17 * (1 - t);
      if (inHead || (inTail && headD > 0.09)) fg++;
    }
  }
  const n = steps * steps;
  return { bg: bg / n, fg: fg / n };
}

function png(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const { bg, fg } = sample(size, x, y);
      const mix = bg > 0 ? fg / bg : 0;
      for (let ch = 0; ch < 3; ch++) {
        raw[o++] = Math.round((BG[ch] ?? 0) * (1 - mix) + (FG[ch] ?? 0) * mix);
      }
      raw[o++] = Math.round(bg * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of SIZES) {
  writeFileSync(`public/icons/${size}.png`, png(size));
}
console.log(`wrote ${SIZES.map((s) => `${s}.png`).join(', ')}`);
