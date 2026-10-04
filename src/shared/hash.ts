/**
 * Deterministic hashing and similarity primitives (DATA_MODEL.md §4). No dependencies.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over UTF-16 code units. Always returns an unsigned 32-bit integer. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Zero-width (U+200B–U+200F), bidi embedding/override (U+202A–U+202E), word joiners and BOM. */
const INVISIBLE_MARKS = /[​-‏‪-‮⁠-⁤﻿]/g;
const PUNCTUATION_RUN = /[\p{P}\p{S}]+/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Normalise text for hashing and similarity: NFC, strip invisible marks, lowercase,
 * collapse punctuation/symbol runs to a single space, collapse whitespace, trim.
 * Punctuation becomes a space (not removed) so adjacent words never merge.
 */
export function normaliseForHash(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE_MARKS, '')
    .toLowerCase()
    .replace(PUNCTUATION_RUN, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

function trigrams(text: string): Set<string> {
  const padded = ` ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Jaccard similarity over character trigrams, in [0, 1].
 * When `minSimilarity` is given and the set sizes make it unreachable, returns 0 early
 * without computing the intersection — callers only compare against their threshold.
 */
export function trigramSimilarity(a: string, b: string, minSimilarity = 0): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  const [small, large] = gramsA.size <= gramsB.size ? [gramsA, gramsB] : [gramsB, gramsA];

  // Jaccard upper bound is |small| / |large| (intersection ≤ |small|, union ≥ |large|).
  if (small.size / large.size < minSimilarity) return 0;

  let intersection = 0;
  for (const gram of small) {
    if (large.has(gram)) intersection++;
  }
  return intersection / (small.size + large.size - intersection);
}
