import { buildZip, forbiddenEntries, readZip, type ZipEntry } from '../../scripts/zip';

describe('zip', () => {
  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: Buffer.from('{"manifest_version":3}') },
    { name: 'assets/content.js', data: Buffer.from('const a = 1;\n'.repeat(500)) },
    { name: 'icons/16.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
  ];

  test('round-trips every file byte-for-byte', () => {
    const back = readZip(buildZip(entries));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    back.forEach((e, i) => expect(e.data.equals(entries[i]!.data)).toBe(true));
  });

  test('a corrupted body fails the CRC check', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('stored-short') }]);
    zip.writeUInt8(zip.readUInt8(30 + 'a.txt'.length) ^ 0xff, 30 + 'a.txt'.length);
    expect(() => readZip(zip)).toThrow(/CRC mismatch/);
  });

  test('is deterministic (fixed timestamps)', () => {
    expect(buildZip(entries).equals(buildZip(entries))).toBe(true);
  });

  test('flags maps, tests, docs, and fixtures', () => {
    const bad = forbiddenEntries([
      ...entries,
      { name: 'assets/content.js.map', data: Buffer.alloc(0) },
      { name: 'tests/x.ts', data: Buffer.alloc(0) },
      { name: 'docs/PRD.md', data: Buffer.alloc(0) },
      { name: 'fixtures/claude/a.html', data: Buffer.alloc(0) },
    ]);
    expect(bad).toEqual(['assets/content.js.map', 'tests/x.ts', 'docs/PRD.md', 'fixtures/claude/a.html']);
  });
});
