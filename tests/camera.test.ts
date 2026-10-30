import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM, MIN_ZOOM } from '../src/render/camera';

describe('Camera', () => {
  it('round-trips screen and world coordinates', () => {
    const cam = new Camera(30, -20, 2.5);
    const p = cam.screenToWorld(cam.worldToScreen({ x: 7, y: 9 }));
    expect(p.x).toBeCloseTo(7);
    expect(p.y).toBeCloseTo(9);
  });

  it('keeps the anchor point fixed while zooming', () => {
    const cam = new Camera(10, 10, 1);
    const anchor = { x: 200, y: 120 };
    const before = cam.screenToWorld(anchor);
    cam.zoomAt(anchor, 3);
    const after = cam.screenToWorld(anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(cam.zoom).toBe(3);
  });

  it('clamps zoom', () => {
    const cam = new Camera();
    cam.zoomAt({ x: 0, y: 0 }, 1e9);
    expect(cam.zoom).toBe(MAX_ZOOM);
    cam.zoomAt({ x: 0, y: 0 }, 1e-9);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('pans', () => {
    const cam = new Camera();
    cam.panBy(5, -3);
    expect(cam.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 5, y: -3 });
  });

  it('fits a rect centered in the viewport', () => {
    const cam = new Camera();
    cam.fit({ x: 100, y: 100, width: 200, height: 100 }, 600, 400, 50);
    expect(cam.zoom).toBeCloseTo(2.5);
    const c = cam.worldToScreen({ x: 200, y: 150 });
    expect(c.x).toBeCloseTo(300);
    expect(c.y).toBeCloseTo(200);
  });
});
