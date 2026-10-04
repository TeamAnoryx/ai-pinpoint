/**
 * Pixel diff for Playwright screenshots without a dependency: decodes 8-bit, non-interlaced
 * RGB/RGBA PNGs (what Chromium emits) with node:zlib and reports the fraction of differing pixels.
 */
import { inflateSync } from 'node:zlib';

interface Image {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Buffer): Image {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error('unsupported PNG');
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? data[y * stride + x - channels]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels]! : 0;
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
      data[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Fraction of pixels whose channels differ by more than `tolerance` (0–255). */
export function diffRatio(a: Buffer, b: Buffer, tolerance = 16): number {
  const x = decodePng(a);
  const y = decodePng(b);
  if (x.width !== y.width || x.height !== y.height) return 1;
  let diff = 0;
  for (let i = 0; i < x.width * x.height; i++) {
    for (let ch = 0; ch < 3; ch++) {
      if (Math.abs(x.data[i * x.channels + ch]! - y.data[i * y.channels + ch]!) > tolerance) {
        diff++;
        break;
      }
    }
  }
  return diff / (x.width * x.height);
}
