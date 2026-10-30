import {
  applyToPoint,
  invert,
  multiply,
  scale,
  translate,
  type Matrix,
  type Point,
} from '../model/matrix';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

/** Maps world space to screen space: `screen = world * zoom + (panX, panY)`. */
export class Camera {
  constructor(
    public panX = 0,
    public panY = 0,
    public zoom = 1,
  ) {}

  get matrix(): Matrix {
    return multiply(translate(this.panX, this.panY), scale(this.zoom));
  }

  worldToScreen(p: Point): Point {
    return applyToPoint(this.matrix, p);
  }

  screenToWorld(p: Point): Point {
    const inv = invert(this.matrix);
    if (!inv) return p;
    return applyToPoint(inv, p);
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  /** Zooms by `factor` keeping the world point under `screenPoint` fixed. */
  zoomAt(screenPoint: Point, factor: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const world = this.screenToWorld(screenPoint);
    this.zoom = next;
    this.panX = screenPoint.x - world.x * next;
    this.panY = screenPoint.y - world.y * next;
  }

  /** Centers and scales the view so `rect` fits in a viewport with `padding` px margin. */
  fit(
    rect: { x: number; y: number; width: number; height: number },
    viewW: number,
    viewH: number,
    padding = 48,
  ): void {
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const z = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h)),
    );
    this.zoom = z;
    this.panX = (viewW - w * z) / 2 - rect.x * z;
    this.panY = (viewH - h * z) / 2 - rect.y * z;
  }
}
