import { describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { applyToPoint, multiply, rotate, translate, type Matrix } from '../src/model/matrix';
import { prng } from '../src/app/demo';
import {
  HANDLE_FRACTION,
  movePatch,
  normalizeAngle,
  resizePatch,
  rotatePatch,
  type Box,
  type ResizeHandle,
} from '../src/tools/transform';

const local = (b: Box): Matrix => multiply(translate(b.x, b.y), rotate(b.rotation));
const worldPoint = (parent: Matrix, b: Box, fx: number, fy: number) =>
  applyToPoint(multiply(parent, local(b)), { x: fx * b.width, y: fy * b.height });

const HANDLES = Object.keys(HANDLE_FRACTION) as ResizeHandle[];

describe('movePatch', () => {
  it('moves by the delta under an identity parent', () => {
    const p = movePatch({ x: 10, y: 20, width: 5, height: 5, rotation: 0 }, [1, 0, 0, 1, 0, 0], {
      x: 7,
      y: -3,
    });
    expect(p).toEqual({ x: 17, y: 17 });
  });

  it('moves the world position by exactly the world delta under a rotated parent', () => {
    const parent = multiply(translate(100, 50), rotate(0.7));
    const start: Box = { x: 12, y: 8, width: 30, height: 20, rotation: 0.3 };
    const delta = { x: 25, y: -40 };
    const patch = movePatch(start, parent, delta);
    const before = worldPoint(parent, start, 0, 0);
    const after = worldPoint(parent, { ...start, ...patch }, 0, 0);
    expect(after.x - before.x).toBeCloseTo(delta.x, 9);
    expect(after.y - before.y).toBeCloseTo(delta.y, 9);
  });
});

describe('resizePatch', () => {
  it('drags the east edge of an axis-aligned box', () => {
    const b: Box = { x: 10, y: 10, width: 100, height: 50, rotation: 0 };
    const r = resizePatch(b, [1, 0, 0, 1, 0, 0], 'e', { x: 160, y: 999 });
    expect(r).toMatchObject({ x: 10, y: 10, width: 150, height: 50 });
  });

  it('drags the north-west corner, moving the origin', () => {
    const b: Box = { x: 10, y: 10, width: 100, height: 50, rotation: 0 };
    const r = resizePatch(b, [1, 0, 0, 1, 0, 0], 'nw', { x: 0, y: 5 });
    expect(r).toMatchObject({ x: 0, y: 5, width: 110, height: 55 });
  });

  it('clamps to the minimum size instead of flipping', () => {
    const b: Box = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    const r = resizePatch(b, [1, 0, 0, 1, 0, 0], 'e', { x: -300, y: 0 });
    expect(r.width).toBe(1);
    expect(r.x).toBe(0);
  });

  it('keeps the aspect ratio with a corner handle', () => {
    const b: Box = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
    const r = resizePatch(b, [1, 0, 0, 1, 0, 0], 'se', { x: 300, y: 60 }, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2, 9);
    expect(r.width).toBeCloseTo(300, 9);
  });

  it('keeps the opposite handle fixed and puts the dragged handle on the pointer, for any rotation and parent', () => {
    const rand = prng(7);
    for (let i = 0; i < 400; i++) {
      const parent = multiply(
        translate(rand() * 200 - 100, rand() * 200 - 100),
        rotate((rand() - 0.5) * 6),
      );
      const start: Box = {
        x: rand() * 100,
        y: rand() * 100,
        width: 20 + rand() * 200,
        height: 20 + rand() * 200,
        rotation: (rand() - 0.5) * 6,
      };
      const handle = HANDLES[Math.floor(rand() * HANDLES.length)] as ResizeHandle;
      const [fx, fy] = HANDLE_FRACTION[handle];
      // Pointer target: a point that stays inside the valid (non-clamped) region.
      const target = worldPoint(
        parent,
        start,
        fx + (rand() - 0.2) * 0.3,
        fy + (rand() - 0.2) * 0.3,
      );
      const q = resizePatch(start, parent, handle, target);
      const next: Box = { ...start, ...q };
      expect(q.rotation).toBe(start.rotation);
      // Opposite handle (or edge midpoint's fixed side) did not move in world space.
      const ox = fx === 0.5 ? 0.5 : 1 - fx;
      const oy = fy === 0.5 ? 0.5 : 1 - fy;
      const fixedBefore = worldPoint(parent, start, ox, oy);
      const fixedAfter = worldPoint(parent, next, ox, oy);
      if (fx !== 0.5 && fy !== 0.5) {
        expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 6);
        expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 6);
      }
      // Edge handles leave the other axis' size alone.
      if (fx === 0.5) expect(q.width).toBeCloseTo(start.width, 6);
      if (fy === 0.5) expect(q.height).toBeCloseTo(start.height, 6);
    }
  });

  it('puts a corner handle exactly under the pointer under a rotated parent', () => {
    const parent = multiply(translate(30, -20), rotate(0.9));
    const start: Box = { x: 40, y: 10, width: 120, height: 80, rotation: -0.4 };
    const target = { x: 210, y: 130 };
    const next: Box = { ...start, ...resizePatch(start, parent, 'se', target) };
    const se = worldPoint(parent, next, 1, 1);
    expect(se.x).toBeCloseTo(target.x, 6);
    expect(se.y).toBeCloseTo(target.y, 6);
  });
});

describe('rotatePatch', () => {
  it('rotates by the angle swept around the center and keeps the center fixed', () => {
    const parent: Matrix = [1, 0, 0, 1, 0, 0];
    const start: Box = { x: 100, y: 100, width: 40, height: 20, rotation: 0 };
    const center = { x: 120, y: 110 };
    const p = rotatePatch(
      start,
      parent,
      { x: center.x + 50, y: center.y },
      { x: center.x, y: center.y + 50 },
    );
    expect(p.rotation).toBeCloseTo(Math.PI / 2, 9);
    const next: Box = { ...start, ...p };
    const c = worldPoint(parent, next, 0.5, 0.5);
    expect(c.x).toBeCloseTo(center.x, 9);
    expect(c.y).toBeCloseTo(center.y, 9);
  });

  it('snaps the absolute rotation under a rotated parent', () => {
    const parent = rotate(0.1);
    const start: Box = { x: 0, y: 0, width: 10, height: 10, rotation: 0 };
    const snap = Math.PI / 12;
    const p = rotatePatch(start, parent, { x: 10, y: 0 }, { x: 10, y: 3 }, { snap });
    const world = p.rotation + 0.1;
    expect(world / snap).toBeCloseTo(Math.round(world / snap), 9);
  });

  it('normalizes angles', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(0.5)).toBe(0.5);
  });

  it('agrees with the document world matrix for a nested rotated node', () => {
    const doc = new SceneDocument();
    const frame = doc.add('frame', { x: 50, y: 60, width: 300, height: 300, rotation: 0.5 });
    const rect = doc.add('rect', { x: 20, y: 30, width: 80, height: 40, rotation: 0.2 }, frame.id);
    const parent = doc.worldMatrix(frame.id);
    const center = applyToPoint(doc.worldMatrix(rect.id), { x: 40, y: 20 });
    const patch = rotatePatch(
      rect,
      parent,
      { x: center.x + 10, y: center.y },
      { x: center.x, y: center.y + 10 },
    );
    doc.update(rect.id, patch);
    const after = applyToPoint(doc.worldMatrix(rect.id), { x: 40, y: 20 });
    expect(after.x).toBeCloseTo(center.x, 9);
    expect(after.y).toBeCloseTo(center.y, 9);
    expect(doc.get(rect.id).rotation).toBeCloseTo(0.2 + Math.PI / 2, 9);
  });
});
