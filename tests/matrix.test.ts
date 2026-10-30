import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  IDENTITY,
  invert,
  multiply,
  rectsIntersect,
  rotate,
  scale,
  transformRectBounds,
  translate,
  unionRect,
} from '../src/model/matrix';

const close = (a: number, b: number): void => expect(a).toBeCloseTo(b, 9);

describe('matrix', () => {
  it('multiply applies the right operand first', () => {
    const m = multiply(translate(10, 0), scale(2));
    expect(applyToPoint(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
  });

  it('identity is neutral', () => {
    const m = multiply(rotate(0.7), translate(3, 4));
    expect(multiply(IDENTITY, m)).toEqual(m);
    expect(multiply(m, IDENTITY)).toEqual(m);
  });

  it('rotates clockwise on screen (y down)', () => {
    const p = applyToPoint(rotate(Math.PI / 2), { x: 1, y: 0 });
    close(p.x, 0);
    close(p.y, 1);
  });

  it('inverts to the identity', () => {
    const m = multiply(translate(5, -7), multiply(rotate(0.4), scale(2, 3)));
    const inv = invert(m);
    expect(inv).not.toBeNull();
    const p = applyToPoint(inv!, applyToPoint(m, { x: 12, y: 34 }));
    close(p.x, 12);
    close(p.y, 34);
  });

  it('returns null for singular matrices', () => {
    expect(invert(scale(0, 1))).toBeNull();
  });

  it('computes bounds of a rotated rect', () => {
    const b = transformRectBounds(rotate(Math.PI / 4), { x: 0, y: 0, width: 10, height: 10 });
    close(b.width, 10 * Math.SQRT2);
    close(b.height, 10 * Math.SQRT2);
    close(b.x, (-10 * Math.SQRT2) / 2);
  });

  it('unions and intersects rects', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 20, y: 5, width: 5, height: 20 };
    expect(unionRect(null, a)).toEqual(a);
    expect(unionRect(a, b)).toEqual({ x: 0, y: 0, width: 25, height: 25 });
    expect(rectsIntersect(a, b)).toBe(false);
    expect(rectsIntersect(a, { x: 10, y: 10, width: 1, height: 1 })).toBe(true);
  });
});
