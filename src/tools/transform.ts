import {
  applyToPoint,
  invert,
  multiply,
  rotate,
  translate,
  type Matrix,
  type Point,
} from '../model/matrix';

/** The part of a node that transforms act on. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Handle position as a fraction of the box (0 = left/top, 1 = right/bottom). */
export const HANDLE_FRACTION: Record<ResizeHandle, readonly [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

export const MIN_SIZE = 1;

function localOf(b: Box): Matrix {
  return multiply(translate(b.x, b.y), rotate(b.rotation));
}

/**
 * Moves a node by a world-space delta. `parentWorld` is the parent's
 * local->world matrix; the delta is mapped through its inverse linear part so
 * the node follows the pointer even under a rotated parent.
 */
export function movePatch(
  start: Box,
  parentWorld: Matrix,
  worldDelta: Point,
): Pick<Box, 'x' | 'y'> {
  const inv = invert(parentWorld);
  if (!inv) return { x: start.x, y: start.y };
  return {
    x: start.x + inv[0] * worldDelta.x + inv[2] * worldDelta.y,
    y: start.y + inv[1] * worldDelta.x + inv[3] * worldDelta.y,
  };
}

export interface ResizeOptions {
  /** Keep the aspect ratio (corner handles only). */
  keepAspect?: boolean;
  minSize?: number;
}

/**
 * Resizes a node by dragging one of its 8 handles to `pointerWorld`.
 * The pointer is mapped into the node's starting local frame, so the opposite
 * edge/corner stays fixed in the parent space for any rotation. The handle
 * cannot cross the opposite edge: the size is clamped to `minSize`.
 */
export function resizePatch(
  start: Box,
  parentWorld: Matrix,
  handle: ResizeHandle,
  pointerWorld: Point,
  opts: ResizeOptions = {},
): Box {
  const min = opts.minSize ?? MIN_SIZE;
  const inv = invert(multiply(parentWorld, localOf(start)));
  if (!inv) return { ...start };
  const q = applyToPoint(inv, pointerWorld);
  const [fx, fy] = HANDLE_FRACTION[handle];

  let left = 0;
  let top = 0;
  let right = start.width;
  let bottom = start.height;
  if (fx === 1) right = Math.max(q.x, left + min);
  else if (fx === 0) left = Math.min(q.x, right - min);
  if (fy === 1) bottom = Math.max(q.y, top + min);
  else if (fy === 0) top = Math.min(q.y, bottom - min);

  if (opts.keepAspect && fx !== 0.5 && fy !== 0.5 && start.width > 0 && start.height > 0) {
    const s = Math.max((right - left) / start.width, (bottom - top) / start.height);
    const w = start.width * s;
    const h = start.height * s;
    if (fx === 1) right = left + w;
    else left = right - w;
    if (fy === 1) bottom = top + h;
    else top = bottom - h;
  }

  const pos = applyToPoint(localOf(start), { x: left, y: top });
  return {
    x: pos.x,
    y: pos.y,
    width: right - left,
    height: bottom - top,
    rotation: start.rotation,
  };
}

export interface RotateOptions {
  /** Snap the resulting world rotation to this many radians (e.g. 15°). */
  snap?: number;
}

/** Wraps an angle into (-π, π]. */
export function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r <= -Math.PI) r += twoPi;
  return r;
}

/**
 * Rotates a node about its center. The rotation changes by the angle swept by
 * the pointer around the center, from `startPointer` to `pointer` (world
 * space). The node's center stays fixed in the parent space.
 */
export function rotatePatch(
  start: Box,
  parentWorld: Matrix,
  startPointer: Point,
  pointer: Point,
  opts: RotateOptions = {},
): Pick<Box, 'x' | 'y' | 'rotation'> {
  const half = { x: start.width / 2, y: start.height / 2 };
  const center = applyToPoint(multiply(parentWorld, localOf(start)), half);
  const a0 = Math.atan2(startPointer.y - center.y, startPointer.x - center.x);
  const a1 = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  let rotation = start.rotation + (a1 - a0);
  if (opts.snap && opts.snap > 0) {
    // Snap the absolute (world) rotation, which is what the user sees.
    const parentRot = Math.atan2(parentWorld[1], parentWorld[0]);
    rotation = Math.round((rotation + parentRot) / opts.snap) * opts.snap - parentRot;
  }
  rotation = normalizeAngle(rotation);
  // Keep the center fixed in parent space.
  const parentCenter = applyToPoint(localOf(start), half);
  const offset = applyToPoint(rotate(rotation), half);
  return { x: parentCenter.x - offset.x, y: parentCenter.y - offset.y, rotation };
}
