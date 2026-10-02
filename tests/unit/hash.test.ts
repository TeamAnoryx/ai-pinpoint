import { fnv1a32, normaliseForHash, trigramSimilarity } from '@shared/hash';

describe('fnv1a32', () => {
  test('matches published FNV-1a 32-bit test vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  test('always returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'x', 'hello world', '😀 emoji', 'a'.repeat(10_000)]) {
      const h = fnv1a32(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  test('is deterministic and input-sensitive', () => {
    expect(fnv1a32('pinned message')).toBe(fnv1a32('pinned message'));
    expect(fnv1a32('pinned message')).not.toBe(fnv1a32('pinned messagE'));
  });
});

describe('normaliseForHash', () => {
  test('lowercases and collapses whitespace', () => {
    expect(normaliseForHash('  Hello\n\n  WORLD\t ')).toBe('hello world');
  });

  test('strips zero-width and bidi marks', () => {
    expect(normaliseForHash('he​llo‏ ‪world‮﻿')).toBe('hello world');
  });

  test('collapses punctuation runs to a space without merging words', () => {
    expect(normaliseForHash('Wait... what?!really')).toBe('wait what really');
    expect(normaliseForHash('a—b')).toBe('a b');
  });

  test('applies NFC so composed and decomposed forms hash equally', () => {
    const composed = 'café';
    const decomposed = 'café';
    expect(normaliseForHash(composed)).toBe(normaliseForHash(decomposed));
    expect(fnv1a32(normaliseForHash(composed))).toBe(fnv1a32(normaliseForHash(decomposed)));
  });

  test('is idempotent', () => {
    const once = normaliseForHash('  Some *Markdown* — text!  ');
    expect(normaliseForHash(once)).toBe(once);
  });
});

describe('trigramSimilarity', () => {
  test('identical strings score 1', () => {
    expect(trigramSimilarity('the quick brown fox', 'the quick brown fox')).toBe(1);
  });

  test('disjoint strings score 0', () => {
    expect(trigramSimilarity('aaaa', 'zzzz')).toBe(0);
  });

  test('empty against non-empty scores 0', () => {
    expect(trigramSimilarity('', 'abc')).toBe(0);
    expect(trigramSimilarity('abc', '')).toBe(0);
  });

  test('near-duplicates score above the 0.92 threshold, different text below', () => {
    const base =
      'refactor the storage layer so every mutation goes through the service worker lock';
    expect(trigramSimilarity(base, `${base}.`)).toBeGreaterThan(0.92);
    expect(trigramSimilarity(base, 'write a haiku about autumn leaves falling')).toBeLessThan(0.2);
  });

  test('is symmetric', () => {
    const a = 'pin and jump to any message';
    const b = 'pin and jump to a message';
    expect(trigramSimilarity(a, b)).toBe(trigramSimilarity(b, a));
  });

  test('exits early with 0 when the threshold is unreachable by size alone', () => {
    const short = 'abc';
    const long = 'abc '.repeat(50) + 'many more distinct trigrams here';
    expect(trigramSimilarity(short, long)).toBeGreaterThan(0);
    expect(trigramSimilarity(short, long, 0.92)).toBe(0);
  });

  test('handles strings shorter than a trigram', () => {
    expect(trigramSimilarity('a', 'a')).toBe(1);
    expect(trigramSimilarity('a', 'b')).toBe(0);
  });
});
