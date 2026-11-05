import type { Rect } from '../model/matrix';

/** Screen-pixel distance within which edges and centers snap. */
export const SNAP_THRESHOLD_PX = 8;

export type Axis = 'x' | 'y';

/** A guide line: `pos` is on `axis`, spanning `from`..`to` along the other axis. */
export interface SnapGuide {
  kind: 'align' | 'spacing';
  axis: Axis;
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  /** Correction to add to the moving rect's position. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

const lo = (r: Rect, a: Axis): number => (a === 'x' ? r.x : r.y);
const size = (r: Rect, a: Axis): number => (a === 'x' ? r.width : r.height);
const hi = (r: Rect, a: Axis): number => lo(r, a) + size(r, a);
const mid = (r: Rect, a: Axis): number => lo(r, a) + size(r, a) / 2;
const flip = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const EPS = 1e-6;

function overlaps(a: Rect, b: Rect, axis: Axis): boolean {
  return lo(a, axis) < hi(b, axis) && lo(b, axis) < hi(a, axis);
}

/** Every position `moving`'s left edge could take to be spaced like a pair of static rects. */
function spacingCandidates(
  moving: Rect,
  targets: readonly Rect[],
  axis: Axis,
): { pos: number; a: Rect; b: Rect }[] {
  const cross = flip(axis);
  const w = size(moving, axis);
  const out: { pos: number; a: Rect; b: Rect }[] = [];
  for (const a of targets) {
    for (const b of targets) {
      if (a === b || hi(a, axis) > lo(b, axis)) continue;
      // The pair must read as a row/column: overlap each other or the moving rect across.
      if (!overlaps(a, b, cross) && !(overlaps(a, moving, cross) && overlaps(b, moving, cross)))
        continue;
      const gap = lo(b, axis) - hi(a, axis);
      out.push({ pos: hi(b, axis) + gap, a, b }); // after b
      out.push({ pos: lo(a, axis) - gap - w, a, b }); // before a
      if (gap >= w) out.push({ pos: hi(a, axis) + (gap - w) / 2, a, b }); // centered between
    }
  }
  return out;
}

/** The smallest in-threshold correction on one axis, or null. */
function solveAxis(
  moving: Rect,
  targets: readonly Rect[],
  axis: Axis,
  threshold: number,
): number | null {
  let best: number | null = null;
  const consider = (delta: number): void => {
    if (Math.abs(delta) > threshold) return;
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  };
  const mine = [lo(moving, axis), mid(moving, axis), hi(moving, axis)];
  for (const t of targets)
    for (const tv of [lo(t, axis), mid(t, axis), hi(t, axis)])
      for (const mv of mine) consider(tv - mv);
  for (const c of spacingCandidates(moving, targets, axis)) consider(c.pos - lo(moving, axis));
  return best;
}

/** Guides for everything `snapped` lines up with exactly on one axis. */
function guidesFor(snapped: Rect, targets: readonly Rect[], axis: Axis): SnapGuide[] {
  const cross = flip(axis);
  const guides: SnapGuide[] = [];
  const mine = [lo(snapped, axis), mid(snapped, axis), hi(snapped, axis)];
  for (const t of targets) {
    for (const tv of [lo(t, axis), mid(t, axis), hi(t, axis)]) {
      if (!mine.some((mv) => Math.abs(mv - tv) < EPS)) continue;
      guides.push({
        kind: 'align',
        axis,
        pos: tv,
        from: Math.min(lo(snapped, cross), lo(t, cross)),
        to: Math.max(hi(snapped, cross), hi(t, cross)),
      });
    }
  }
  for (const c of spacingCandidates(snapped, targets, axis)) {
    if (Math.abs(c.pos - lo(snapped, axis)) >= EPS) continue;
    for (const r of [c.a, c.b]) {
      for (const pos of [lo(r, axis), hi(r, axis)])
        guides.push({ kind: 'spacing', axis, pos, from: lo(r, cross), to: hi(r, cross) });
    }
  }
  return guides;
}

/**
 * Finds the smallest per-axis correction that lines `moving` up with `targets` (edges and centers
 * of siblings or the parent frame) or gives it the same spacing as a pair of targets. `threshold`
 * is in world units: use `SNAP_THRESHOLD_PX / zoom`. Axes snap independently.
 */
export function solveSnap(moving: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  const dx = solveAxis(moving, targets, 'x', threshold);
  const dy = solveAxis(moving, targets, 'y', threshold);
  const snapped: Rect = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) };
  const guides = [
    ...(dx === null ? [] : guidesFor(snapped, targets, 'x')),
    ...(dy === null ? [] : guidesFor(snapped, targets, 'y')),
  ];
  return { dx: dx ?? 0, dy: dy ?? 0, guides };
}
