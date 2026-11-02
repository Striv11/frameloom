import type { Point, Rect } from './matrix';

/**
 * A bezier anchor. `in`/`out` are control-handle offsets relative to the
 * anchor (zero = no handle, i.e. a corner). Anchors are treated as immutable:
 * edits always produce a new array, so history snapshots can share them.
 */
export interface PathAnchor {
  readonly x: number;
  readonly y: number;
  readonly inX: number;
  readonly inY: number;
  readonly outX: number;
  readonly outY: number;
}

/** A cubic segment: start, two control points, end. */
export type Cubic = readonly [Point, Point, Point, Point];

export function anchor(x: number, y: number, outX = 0, outY = 0): PathAnchor {
  // A dragged-out handle mirrors to the incoming side (smooth anchor).
  return { x, y, inX: -outX || 0, inY: -outY || 0, outX, outY };
}

/** Cubic segments between consecutive anchors (plus the closing one). */
export function pathSegments(anchors: readonly PathAnchor[], closed: boolean): Cubic[] {
  const out: Cubic[] = [];
  const n = anchors.length;
  const last = closed && n > 1 ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = anchors[i] as PathAnchor;
    const b = anchors[(i + 1) % n] as PathAnchor;
    out.push([
      { x: a.x, y: a.y },
      { x: a.x + a.outX, y: a.y + a.outY },
      { x: b.x + b.inX, y: b.y + b.inY },
      { x: b.x, y: b.y },
    ]);
  }
  return out;
}

export function cubicPoint(c: Cubic, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * c[0].x + w1 * c[1].x + w2 * c[2].x + w3 * c[3].x,
    y: w0 * c[0].y + w1 * c[1].y + w2 * c[2].y + w3 * c[3].y,
  };
}

/** Parameters in (0,1) where d/dt of one coordinate is zero (at most two). */
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t)/3 = a t^2 + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      ts.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

/** Exact axis-aligned bounds of one cubic (endpoints plus derivative roots). */
export function cubicBounds(c: Cubic): Rect {
  const pts: Point[] = [c[0], c[3]];
  for (const t of extrema(c[0].x, c[1].x, c[2].x, c[3].x)) pts.push(cubicPoint(c, t));
  for (const t of extrema(c[0].y, c[1].y, c[2].y, c[3].y)) pts.push(cubicPoint(c, t));
  return boundsOfPoints(pts) as Rect;
}

function boundsOfPoints(pts: readonly Point[]): Rect | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Exact bounds of the curve itself (control points excluded); null if no anchors. */
export function pathBounds(anchors: readonly PathAnchor[], closed: boolean): Rect | null {
  if (anchors.length === 0) return null;
  if (anchors.length === 1) {
    const a = anchors[0] as PathAnchor;
    return { x: a.x, y: a.y, width: 0, height: 0 };
  }
  let acc: Rect | null = null;
  for (const seg of pathSegments(anchors, closed)) {
    const b = cubicBounds(seg);
    if (!acc) {
      acc = b;
      continue;
    }
    const x = Math.min(acc.x, b.x);
    const y = Math.min(acc.y, b.y);
    acc = {
      x,
      y,
      width: Math.max(acc.x + acc.width, b.x + b.width) - x,
      height: Math.max(acc.y + acc.height, b.y + b.height) - y,
    };
  }
  return acc;
}

/**
 * Adaptive flattening: subdivide at t=0.5 until both control points lie within
 * `tolerance` of the chord. Returns points including both endpoints.
 */
export function flattenCubic(c: Cubic, tolerance = 0.25, depth = 0): Point[] {
  if (depth >= 16 || isFlat(c, tolerance)) return [c[0], c[3]];
  const [l, r] = splitCubic(c, 0.5);
  const left = flattenCubic(l, tolerance, depth + 1);
  return left.concat(flattenCubic(r, tolerance, depth + 1).slice(1));
}

function isFlat(c: Cubic, tol: number): boolean {
  return distToLine(c[1], c[0], c[3]) <= tol && distToLine(c[2], c[0], c[3]) <= tol;
}

function distToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** de Casteljau split. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: Point, b: Point): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const ab = lerp(c[0], c[1]);
  const bc = lerp(c[1], c[2]);
  const cd = lerp(c[2], c[3]);
  const abc = lerp(ab, bc);
  const bcd = lerp(bc, cd);
  const m = lerp(abc, bcd);
  return [
    [c[0], ab, abc, m],
    [m, bcd, cd, c[3]],
  ];
}

/** The whole path as one polyline per subpath (a path is a single subpath). */
export function flattenPath(
  anchors: readonly PathAnchor[],
  closed: boolean,
  tolerance = 0.25,
): Point[] {
  if (anchors.length === 0) return [];
  const first = anchors[0] as PathAnchor;
  const pts: Point[] = [{ x: first.x, y: first.y }];
  for (const seg of pathSegments(anchors, closed))
    pts.push(...flattenCubic(seg, tolerance).slice(1));
  return pts;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Smallest distance from `p` to the curve (accurate to the flattening tolerance). */
export function distanceToPath(
  anchors: readonly PathAnchor[],
  closed: boolean,
  p: Point,
  tolerance = 0.1,
): number {
  const pts = flattenPath(anchors, closed, tolerance);
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - (pts[0] as Point).x, p.y - (pts[0] as Point).y);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    best = Math.min(best, distToSegment(p, pts[i] as Point, pts[i + 1] as Point));
  }
  return best;
}

/** Non-zero winding test against the flattened closed path. */
export function pathContains(anchors: readonly PathAnchor[], p: Point): boolean {
  const pts = flattenPath(anchors, true, 0.1);
  let winding = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Point;
    const b = pts[(i + 1) % pts.length] as Point;
    if (a.y <= p.y) {
      if (b.y > p.y && cross(a, b, p) > 0) winding++;
    } else if (b.y <= p.y && cross(a, b, p) < 0) {
      winding--;
    }
  }
  return winding !== 0;
}

function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
}

/**
 * Translates anchors so the curve's bounds start at (0,0). Returns the new
 * anchors, the shift that was removed (add it to the node position) and size.
 */
export function normalizePath(
  anchors: readonly PathAnchor[],
  closed: boolean,
): { anchors: PathAnchor[]; dx: number; dy: number; width: number; height: number } {
  const b = pathBounds(anchors, closed) ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    anchors: anchors.map((a) => ({ ...a, x: a.x - b.x, y: a.y - b.y })),
    dx: b.x,
    dy: b.y,
    width: b.width,
    height: b.height,
  };
}

/**
 * Is `p` on the path or, for a closed filled path, inside it?
 */
export function pathHit(
  anchors: readonly PathAnchor[],
  closed: boolean,
  filled: boolean,
  strokeHalf: number,
  p: Point,
): boolean {
  if (closed && filled && pathContains(anchors, p)) return true;
  return distanceToPath(anchors, closed, p) <= strokeHalf;
}
