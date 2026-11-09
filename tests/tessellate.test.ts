import { describe, expect, it } from 'vitest';
import { anchor } from '../src/model/path';
import { SceneDocument } from '../src/model/document';
import { requestedRenderer } from '../src/render/create-renderer';
import {
  arcSegments,
  isConvex,
  outline,
  parseColor,
  roundedRect,
  strokeTriangles,
  triangulate,
} from '../src/render/tessellate';
import type { Point } from '../src/model/matrix';

function area(pts: Point[], tri: number[]): number {
  let total = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const a = pts[tri[i] as number] as Point;
    const b = pts[tri[i + 1] as number] as Point;
    const c = pts[tri[i + 2] as number] as Point;
    total += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }
  return total;
}

function polyArea(pts: Point[]): number {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length] as Point;
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
}

describe('parseColor', () => {
  it('parses hex and rgb forms', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseColor('#ff000080')[3]).toBeCloseTo(128 / 255);
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([1, 0, 0, 0.5]);
    expect(parseColor('rgb(0 255 0 / 50%)')).toEqual([0, 1, 0, 0.5]);
  });
  it('falls back to magenta for unknown input', () => {
    expect(parseColor('papayawhip')).toEqual([1, 0, 1, 1]);
    expect(parseColor('#12')).toEqual([1, 0, 1, 1]);
    expect(parseColor('rgb(1,2)')).toEqual([1, 0, 1, 1]);
  });
});

describe('triangulate', () => {
  it('fans convex polygons', () => {
    const sq: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(isConvex(sq)).toBe(true);
    const t = triangulate(sq);
    expect(t).toHaveLength(6);
    expect(area(sq, t)).toBeCloseTo(16);
  });

  it('ear-clips a concave polygon in either winding with exact area', () => {
    const arrow: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 3 }, // reflex notch
      { x: 0, y: 10 },
    ];
    expect(isConvex(arrow)).toBe(false);
    for (const pts of [arrow, [...arrow].reverse()]) {
      const t = triangulate(pts);
      expect(t).toHaveLength(9);
      expect(area(pts, t)).toBeCloseTo(polyArea(pts));
    }
  });

  it('handles a many-vertex star and terminates on degenerate input', () => {
    const star: Point[] = [];
    for (let i = 0; i < 20; i++) {
      const r = i % 2 ? 4 : 10;
      const a = (i / 20) * Math.PI * 2;
      star.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    expect(area(star, triangulate(star))).toBeCloseTo(polyArea(star), 6);
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => triangulate(line)).not.toThrow();
    expect(
      triangulate([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([]);
  });
});

describe('outline', () => {
  const doc = new SceneDocument();
  it('rounded rects stay inside their box and cover nearly the full area', () => {
    const pts = roundedRect(100, 60, 10, 10);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(60 + 1e-9);
    }
    expect(Math.abs(polyArea(pts) - (100 * 60 - (4 - Math.PI) * 100))).toBeLessThan(2);
    expect(isConvex(pts)).toBe(true);
  });

  it('radius is clamped to half the shorter side', () => {
    expect(polyArea(roundedRect(20, 10, 999, 1))).toBeLessThan(200);
    expect(roundedRect(20, 10, 0, 1)).toHaveLength(4);
  });

  it('ellipse area approaches pi*rx*ry and more segments at higher zoom', () => {
    const e = doc.add('ellipse', { x: 0, y: 0, width: 80, height: 40 });
    const lo = outline(e, 1) as Point[];
    const hi = outline(e, 20) as Point[];
    expect(hi.length).toBeGreaterThan(lo.length);
    expect(polyArea(hi)).toBeCloseTo(Math.PI * 40 * 20, -1);
  });

  it('closed paths drop the repeated end point; groups and lines have none', () => {
    const p = doc.add('path', {
      anchors: [anchor(0, 0), anchor(50, 0), anchor(50, 50)],
      closed: true,
    });
    const pts = outline(p, 1) as Point[];
    expect(pts).toHaveLength(3);
    expect(outline(doc.add('group', {}), 1)).toBeNull();
    expect(outline(doc.add('line', { width: 5, height: 5 }), 1)).toBeNull();
  });
});

describe('strokeTriangles', () => {
  it('emits a quad per segment with the right width', () => {
    const t = strokeTriangles(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      4,
      false,
      0.1, // hairline on screen: no round caps
    );
    expect(t).toHaveLength(12);
    const ys = t.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4);
  });

  it('adds round joins when the stroke is wide on screen, and closes loops', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const open = strokeTriangles(pts, 4, false, 4);
    const closed = strokeTriangles(pts, 4, true, 4);
    expect(open.length).toBeGreaterThan(24);
    expect(closed.length).toBeGreaterThan(open.length);
    expect(strokeTriangles(pts, 0, false, 1)).toEqual([]);
  });
});

describe('renderer selection', () => {
  it('only the webgl flag opts in', () => {
    expect(requestedRenderer('?renderer=webgl')).toBe('webgl');
    expect(requestedRenderer('?renderer=canvas2d')).toBe('canvas2d');
    expect(requestedRenderer('')).toBe('canvas2d');
  });
  it('arcSegments is monotone and bounded', () => {
    expect(arcSegments(1)).toBeLessThanOrEqual(arcSegments(100));
    expect(arcSegments(1e6)).toBe(256);
    expect(arcSegments(0)).toBe(8);
  });
});
