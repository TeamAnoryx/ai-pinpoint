/**
 * `pnpm package` (TECH_STACK.md §10): zips the production `dist/` into
 * `release/ai-pinpoint-<version>.zip`. Dependency-free ZIP writer (deflate via node:zlib),
 * so packaging adds nothing to the dependency surface. Refuses to package source maps,
 * tests, docs, fixtures, or a manifest whose version differs from package.json.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const RELEASE = join(ROOT, 'release');

/** Paths that must never ship (TECH_STACK.md §10 step 4). */
const FORBIDDEN = [/\.map$/, /(^|\/)tests?\//, /(^|\/)docs\//, /(^|\/)fixtures?\//, /(^|\/)\.vite\//];

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function collect(dir: string): ZipEntry[] {
  return walk(dir)
    .map((full) => ({ name: relative(dir, full).split(sep).join('/'), data: readFileSync(full) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function forbiddenEntries(entries: readonly ZipEntry[]): string[] {
  return entries.filter((e) => FORBIDDEN.some((re) => re.test(e.name))).map((e) => e.name);
}

/** DOS date/time for 1980-01-01 00:00: fixed, so the same build zips byte-identically. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

/** Read back an archive written by `buildZip` (central directory walk). */
export function readZip(zip: Buffer): ZipEntry[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch: ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return out;
}

/** Unpack an archive into `dir` (replacing it) — used by the packaged-build smoke test. */
export function extractZip(zipPath: string, dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  for (const { name, data } of readZip(readFileSync(zipPath))) {
    const target = join(dir, name);
    if (relative(dir, target).startsWith('..')) throw new Error(`unsafe path in archive: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')) as { version: string };
  if (manifest.version !== pkg.version) {
    throw new Error(`manifest version ${manifest.version} does not match package.json ${pkg.version}`);
  }
  const entries = collect(DIST);
  const bad = forbiddenEntries(entries);
  if (bad.length > 0) throw new Error(`refusing to package: ${bad.join(', ')}`);
  mkdirSync(RELEASE, { recursive: true });
  const out = join(RELEASE, `ai-pinpoint-${pkg.version}.zip`);
  const zip = buildZip(entries);
  writeFileSync(out, zip);
  console.log(`package — ${relative(ROOT, out)} (${entries.length} files, ${(zip.length / 1024).toFixed(1)} KB)`);
}

if (process.argv[1] && process.argv[1].endsWith('zip.ts')) main();
