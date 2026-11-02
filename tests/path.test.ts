import { describe, expect, it } from 'vitest';
import {
  anchor,
  cubicBounds,
  cubicPoint,
  distanceToPath,
  flattenCubic,
  flattenPath,
  normalizePath,
  pathBounds,
  pathContains,
  pathHit,
  pathSegments,
  splitCubic,
  type Cubic,
  type PathAnchor,
} from '../src/model/path';

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomCubic(r: () => number): Cubic {
  const p = (): { x: number; y: number } => ({ x: r() * 200 - 100, y: r() * 200 - 100 });
  return [p(), p(), p(), p()];
}

describe('cubic geometry', () => {
  it('evaluates endpoints and midpoint of a straight cubic', () => {
    const c: Cubic = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(cubicPoint(c, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicPoint(c, 1)).toEqual({ x: 30, y: 0 });
    expect(cubicPoint(c, 0.5).x).toBeCloseTo(15);
  });

  it('bounds are exact: a bulging arc extends beyond its endpoints', () => {
    // Symmetric arc: y peaks at 0.75 * 100 = 75 at t=0.5.
    const c: Cubic = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ];
    const b = cubicBounds(c);
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(100);
    expect(b.height).toBeCloseTo(75);
  });

  it('bounds match dense sampling for random cubics', () => {
    const r = rng(7);
    for (let k = 0; k < 200; k++) {
      const c = randomCubic(r);
      const b = cubicBounds(c);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i <= 2000; i++) {
        const p = cubicPoint(c, i / 2000);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      // Exact bounds contain every sample and are within sampling error of it.
      expect(b.x).toBeLessThanOrEqual(minX + 1e-9);
      expect(b.y).toBeLessThanOrEqual(minY + 1e-9);
      expect(b.x + b.width).toBeGreaterThanOrEqual(maxX - 1e-9);
      expect(b.y + b.height).toBeGreaterThanOrEqual(maxY - 1e-9);
      expect(minX - b.x).toBeLessThan(0.1);
      expect(minY - b.y).toBeLessThan(0.1);
      expect(b.x + b.width - maxX).toBeLessThan(0.1);
      expect(b.y + b.height - maxY).toBeLessThan(0.1);
    }
  });

  it('splitting preserves the curve', () => {
    const r = rng(3);
    const c = randomCubic(r);
    const [l, rt] = splitCubic(c, 0.3);
    expect(cubicPoint(l, 1).x).toBeCloseTo(cubicPoint(c, 0.3).x);
    expect(cubicPoint(rt, 0).y).toBeCloseTo(cubicPoint(c, 0.3).y);
    expect(cubicPoint(rt, 0.5).x).toBeCloseTo(cubicPoint(c, 0.65).x);
  });
});

describe('flattening', () => {
  it('a straight cubic flattens to two points', () => {
    const c: Cubic = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(flattenCubic(c)).toHaveLength(2);
  });

  it('stays within tolerance of the true curve and starts/ends on it', () => {
    const r = rng(11);
    for (let k = 0; k < 50; k++) {
      const c = randomCubic(r);
      const tol = 0.25;
      const pts = flattenCubic(c, tol);
      expect(pts[0]).toEqual(c[0]);
      expect(pts[pts.length - 1]).toEqual(c[3]);
      for (let i = 0; i <= 100; i++) {
        const p = cubicPoint(c, i / 100);
        let best = Infinity;
        for (let j = 0; j + 1 < pts.length; j++) {
          const a = pts[j] as { x: number; y: number };
          const b = pts[j + 1] as { x: number; y: number };
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          const t =
            l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
          best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
        }
        expect(best).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('tighter tolerance yields more points', () => {
    const c: Cubic = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ];
    expect(flattenCubic(c, 0.01).length).toBeGreaterThan(flattenCubic(c, 1).length);
  });
});

describe('paths', () => {
  const arc: PathAnchor[] = [anchor(0, 0, 0, 100), { ...anchor(100, 0), inX: 0, inY: 100 }];

  it('builds segments, plus a closing one when closed', () => {
    const tri = [anchor(0, 0), anchor(10, 0), anchor(5, 10)];
    expect(pathSegments(tri, false)).toHaveLength(2);
    expect(pathSegments(tri, true)).toHaveLength(3);
    expect(pathSegments([anchor(1, 1)], true)).toHaveLength(0);
  });

  it('pathBounds covers the curve, not the control points', () => {
    const b = pathBounds(arc, false);
    expect(b?.height).toBeCloseTo(75);
    expect(b?.width).toBeCloseTo(100);
    expect(pathBounds([], false)).toBeNull();
    expect(pathBounds([anchor(4, 5)], false)).toEqual({ x: 4, y: 5, width: 0, height: 0 });
  });

  it('normalizePath moves the bounds origin to (0,0)', () => {
    const shifted = arc.map((a) => ({ ...a, x: a.x + 50, y: a.y - 20 }));
    const n = normalizePath(shifted, false);
    expect(n.dx).toBeCloseTo(50);
    expect(n.dy).toBeCloseTo(-20);
    expect(n.width).toBeCloseTo(100);
    const b = pathBounds(n.anchors, false);
    expect(b?.x).toBeCloseTo(0);
    expect(b?.y).toBeCloseTo(0);
  });

  it('distanceToPath measures to the curve', () => {
    const line = [anchor(0, 0), anchor(100, 0)];
    expect(distanceToPath(line, false, { x: 50, y: 7 })).toBeCloseTo(7);
    expect(distanceToPath(line, false, { x: -3, y: 4 })).toBeCloseTo(5);
    // The arc peaks at y=75 above the chord's midpoint.
    expect(distanceToPath(arc, false, { x: 50, y: 75 })).toBeLessThan(0.2);
    expect(distanceToPath(arc, false, { x: 50, y: -50 })).toBeGreaterThan(60);
  });

  it('pathContains uses winding for curved closed paths', () => {
    const sq = [anchor(0, 0), anchor(10, 0), anchor(10, 10), anchor(0, 10)];
    expect(pathContains(sq, { x: 5, y: 5 })).toBe(true);
    expect(pathContains(sq, { x: 15, y: 5 })).toBe(false);
    // Closed bulge: a "D" shape, inside the bulge but outside the chord box.
    const d = [
      { ...anchor(0, 0, 30, 0), inX: 0 },
      { ...anchor(0, 40), inX: 30, inY: 0, outX: 0, outY: 0 },
    ];
    expect(pathContains(d, { x: 10, y: 20 })).toBe(true);
    expect(pathContains(d, { x: -10, y: 20 })).toBe(false);
    expect(pathContains(d, { x: 30, y: 20 })).toBe(false); // bulge peaks at x = 22.5
  });

  it('pathHit: strokes need proximity, closed fills hit the interior', () => {
    const sq = [anchor(0, 0), anchor(10, 0), anchor(10, 10), anchor(0, 10)];
    expect(pathHit(sq, true, true, 1, { x: 5, y: 5 })).toBe(true);
    expect(pathHit(sq, true, false, 1, { x: 5, y: 5 })).toBe(false);
    expect(pathHit(sq, true, false, 1, { x: 5, y: 0.5 })).toBe(true);
    // Open paths are never filled.
    expect(pathHit(sq, false, true, 1, { x: 5, y: 5 })).toBe(false);
  });

  it('flattenPath includes the closing segment', () => {
    const tri = [anchor(0, 0), anchor(10, 0), anchor(5, 10)];
    const pts = flattenPath(tri, true);
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
    expect(flattenPath([], false)).toEqual([]);
  });
});
