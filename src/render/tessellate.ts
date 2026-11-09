import type { Point } from '../model/matrix';
import { flattenPath } from '../model/path';
import type { SceneNode } from '../model/types';

/** Straight (non-premultiplied) RGBA, each channel 0..1. */
export type Rgba = readonly [number, number, number, number];

const FALLBACK: Rgba = [1, 0, 1, 1];

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Anything else is magenta. */
export function parseColor(css: string): Rgba {
  const s = css.trim().toLowerCase();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return FALLBACK;
    const full =
      h.length === 3 || h.length === 4
        ? [...h].map((c) => c + c).join('')
        : h.length === 6 || h.length === 8
          ? h
          : null;
    if (!full) return FALLBACK;
    const c = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
    return [c(0), c(2), c(4), full.length === 8 ? c(6) : 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = (m[1] ?? '').split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return FALLBACK;
    const ch = (p: string): number =>
      p.endsWith('%') ? parseFloat(p) / 100 : Math.min(255, parseFloat(p)) / 255;
    const rgb = parts.slice(0, 3).map(ch);
    const a =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith('%')
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3]);
    if (rgb.some(Number.isNaN) || Number.isNaN(a)) return FALLBACK;
    return [rgb[0] as number, rgb[1] as number, rgb[2] as number, Math.min(1, Math.max(0, a))];
  }
  return FALLBACK;
}

/** Segments needed so an arc of radius `r` (screen px) deviates less than `tol` px from the circle. */
export function arcSegments(r: number, tol = 0.25): number {
  if (r <= tol) return 8;
  const n = Math.ceil(Math.PI / Math.acos(1 - tol / r));
  return Math.min(256, Math.max(12, n));
}

/**
 * Closed outline of a shape in local space (counter-clockwise in a y-down space is not
 * guaranteed; callers must not rely on winding). `scale` is screen pixels per local unit.
 * Returns `null` for nodes that have no fillable outline (groups, text, lines).
 */
export function outline(n: SceneNode, scale: number): Point[] | null {
  switch (n.type) {
    case 'frame':
    case 'rect':
      return roundedRect(n.width, n.height, n.cornerRadius, scale);
    case 'ellipse': {
      const rx = n.width / 2;
      const ry = n.height / 2;
      const count = arcSegments(Math.max(rx, ry) * scale);
      const pts: Point[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        pts.push({ x: rx + rx * Math.cos(a), y: ry + ry * Math.sin(a) });
      }
      return pts;
    }
    case 'path': {
      if (n.anchors.length < 2) return null;
      const pts = flattenPath(n.anchors, n.closed, 0.25 / scale);
      const f = pts[0] as Point;
      const l = pts[pts.length - 1] as Point;
      // A closed path's last point repeats the first; drop it.
      if (n.closed && pts.length > 1 && f.x === l.x && f.y === l.y) pts.pop();
      return pts;
    }
    default:
      return null;
  }
}

export function roundedRect(w: number, h: number, radius: number, scale: number): Point[] {
  const r = Math.min(Math.max(0, radius), w / 2, h / 2);
  if (r <= 0) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  const per = Math.max(3, Math.ceil(arcSegments(r * scale) / 4));
  const pts: Point[] = [];
  const corners: [number, number, number][] = [
    [w - r, r, -Math.PI / 2],
    [w - r, h - r, 0],
    [r, h - r, Math.PI / 2],
    [r, r, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = start + (i / per) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }
  return pts;
}

function signedArea(pts: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Point;
    const q = pts[(i + 1) % pts.length] as Point;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** True if the polygon is convex (collinear points allowed). */
export function isConvex(pts: readonly Point[]): boolean {
  let sign = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const c = cross(pts[i] as Point, pts[(i + 1) % n] as Point, pts[(i + 2) % n] as Point);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Triangulates a simple polygon into index triples. Convex polygons use a fan; others use ear
 * clipping (O(n²), fine for flattened paths). Self-intersecting input yields a best-effort
 * result that does not match the non-zero fill rule.
 */
export function triangulate(pts: readonly Point[]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  if (isConvex(pts)) {
    const out: number[] = [];
    for (let i = 1; i < n - 1; i++) out.push(0, i, i + 1);
    return out;
  }
  const ccw = signedArea(pts) > 0;
  const idx = pts.map((_, i) => i);
  if (!ccw) idx.reverse();
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length] as number;
      const ib = idx[k] as number;
      const ic = idx[(k + 1) % idx.length] as number;
      const a = pts[ia] as Point;
      const b = pts[ib] as Point;
      const c = pts[ic] as Point;
      if (cross(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let ear = true;
      for (const other of idx) {
        if (other === ia || other === ib || other === ic) continue;
        const p = pts[other] as Point;
        if ((p.x === a.x && p.y === a.y) || (p.x === c.x && p.y === c.y)) continue;
        if (inTriangle(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(ia, ib, ic);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate input: drop the flattest vertex so we always terminate.
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) out.push(idx[0] as number, idx[1] as number, idx[2] as number);
  return out;
}

/**
 * Stroke geometry as a flat triangle list (x,y pairs, 6 floats per quad segment). Each segment is
 * a quad of the given width; joins and caps are round discs, matching the Canvas2D renderer's
 * round caps. Overlaps between pieces are not merged (see README limits).
 */
export function strokeTriangles(
  pts: readonly Point[],
  width: number,
  closed: boolean,
  scale: number,
): number[] {
  const out: number[] = [];
  const n = pts.length;
  if (n < 2 || width <= 0) return out;
  const half = width / 2;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i] as Point;
    const b = pts[(i + 1) % n] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    out.push(
      a.x + nx, a.y + ny, a.x - nx, a.y - ny, b.x + nx, b.y + ny,
      b.x + nx, b.y + ny, a.x - nx, a.y - ny, b.x - nx, b.y - ny,
    ); // prettier-ignore
  }
  // Round joins/caps: skip hairline strokes where a bevel is invisible.
  if (half * scale > 0.75) {
    const count = Math.max(8, Math.min(24, Math.ceil(arcSegments(half * scale) / 2)));
    for (let i = 0; i < n; i++) {
      const c = pts[i] as Point;
      for (let k = 0; k < count; k++) {
        const a0 = (k / count) * Math.PI * 2;
        const a1 = ((k + 1) / count) * Math.PI * 2;
        out.push(
          c.x, c.y,
          c.x + half * Math.cos(a0), c.y + half * Math.sin(a0),
          c.x + half * Math.cos(a1), c.y + half * Math.sin(a1),
        ); // prettier-ignore
      }
    }
  }
  return out;
}
