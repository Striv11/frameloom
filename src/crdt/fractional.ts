/**
 * Fractional indexing: string keys that sort lexicographically, with a key
 * always available strictly between any two keys (or before/after one).
 * Digits are base-62 in ASCII order; a key is a fraction 0.d1d2d3... and never
 * ends in the zero digit, which keeps `between(a, b)` always solvable.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digit(key: string, i: number): number {
  return i < key.length ? DIGITS.indexOf(key[i] as string) : 0;
}

/** A key strictly between `a` and `b` (`null` = unbounded). Requires a < b. */
export function between(a: string | null, b: string | null): string {
  const lo = a ?? '';
  if (b !== null && lo >= b) throw new Error(`between: ${lo} is not before ${b}`);
  let out = '';
  for (let i = 0; ; i++) {
    const da = digit(lo, i);
    const db = b === null ? BASE : digit(b, i);
    if (da === db) {
      out += DIGITS[da];
      continue;
    }
    if (db - da > 1) return out + DIGITS[(da + db) >> 1];
    // db === da + 1: keep a's digit, then only a's tail bounds us from below.
    out += DIGITS[da];
    for (let j = i + 1; ; j++) {
      const dj = digit(lo, j);
      if (dj < BASE - 1) return out + DIGITS[(dj + BASE) >> 1];
      out += DIGITS[dj];
    }
  }
}

/** `n` increasing keys between `a` and `b`, spread by repeated bisection. */
export function betweenMany(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  const mid = between(a, b);
  const left = Math.floor((n - 1) / 2);
  return [...betweenMany(a, mid, left), mid, ...betweenMany(mid, b, n - 1 - left)];
}
