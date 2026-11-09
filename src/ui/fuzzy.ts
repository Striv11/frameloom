export interface FuzzyMatch {
  score: number;
  /** Indices in the candidate that matched the query, ascending. */
  positions: number[];
}

const isBoundary = (s: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = s[i - 1] as string;
  return prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === ':';
};

/**
 * Subsequence fuzzy match, case-insensitive. Returns null when `query` is not a subsequence of
 * `text`. Higher scores are better: consecutive runs and word starts earn bonuses, gaps and a
 * late first match cost points. A dynamic program finds the best alignment (not just the greedy one).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (q.length === 0) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  if (q.length > t.length) return null;
  const n = t.length;
  const m = q.length;
  const NEG = -Infinity;
  // best[i][j]: best score matching q[0..i] with q[i] at t[j]. from[i][j] = previous j.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row: number[] = new Array<number>(n).fill(NEG);
    const prevIdx: number[] = new Array<number>(n).fill(-1);
    for (let j = i; j < n; j++) {
      if (t[j] !== q[i]) continue;
      const bonus = (isBoundary(text, j) ? 8 : 0) + (text[j] !== t[j] && j > 0 ? 2 : 0);
      if (i === 0) {
        row[j] = 10 + bonus - Math.min(j, 10);
        continue;
      }
      const prev = best[i - 1] as number[];
      let bestPrev = NEG;
      let bestK = -1;
      for (let k = i - 1; k < j; k++) {
        const p = prev[k] as number;
        if (p === NEG) continue;
        const gap = j - k - 1;
        const s = p + (gap === 0 ? 12 : -Math.min(gap, 6));
        if (s > bestPrev) {
          bestPrev = s;
          bestK = k;
        }
      }
      if (bestK >= 0) {
        row[j] = bestPrev + 10 + bonus;
        prevIdx[j] = bestK;
      }
    }
    best.push(row);
    from.push(prevIdx);
  }
  const last = best[m - 1] as number[];
  let end = -1;
  let score = NEG;
  for (let j = 0; j < n; j++) {
    if ((last[j] as number) > score) {
      score = last[j] as number;
      end = j;
    }
  }
  if (end < 0) return null;
  const positions: number[] = [];
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions.unshift(j);
    j = (from[i] as number[])[j] as number;
  }
  // Prefer shorter candidates on ties.
  return { score: score - n * 0.01, positions };
}

/** Filters and ranks items by fuzzy score on `label`; stable for equal scores. */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string,
): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch; i: number }[] = [];
  items.forEach((item, i) => {
    const match = fuzzyMatch(query, label(item));
    if (match) out.push({ item, match, i });
  });
  out.sort((a, b) => b.match.score - a.match.score || a.i - b.i);
  return out.map(({ item, match }) => ({ item, match }));
}
