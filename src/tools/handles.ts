import type { SceneDocument } from '../model/document';
import {
  applyToPoint,
  translate,
  unionRect,
  type Matrix,
  type Point,
  type Rect,
} from '../model/matrix';
import type { NodeId } from '../model/types';
import type { Camera } from '../render/camera';
import { HANDLE_FRACTION, type ResizeHandle } from './transform';

export type HandleKind = ResizeHandle | 'rotate';

/** The box drawn around the selection: a local->world matrix plus a size. */
export interface SelectionFrame {
  matrix: Matrix;
  width: number;
  height: number;
  resizable: boolean;
  rotatable: boolean;
}

export const ROTATE_HANDLE_OFFSET = 24;
const HANDLE_ORDER: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * A single node gets its true (possibly rotated) box with resize and rotate
 * handles. Several nodes get their world AABB and can only be moved.
 * Lines and groups can be rotated but not resized by handles.
 */
export function selectionFrame(doc: SceneDocument, ids: readonly NodeId[]): SelectionFrame | null {
  const [only, ...rest] = ids;
  if (only === undefined) return null;
  if (rest.length === 0) {
    const n = doc.get(only);
    return {
      matrix: doc.worldMatrix(only),
      width: n.width,
      height: n.height,
      resizable: n.type !== 'line' && n.type !== 'group' && n.type !== 'path',
      rotatable: true,
    };
  }
  let b: Rect | null = null;
  for (const id of ids) {
    const sb = doc.subtreeBounds(id);
    if (sb) b = unionRect(b, sb);
  }
  if (!b) return null;
  return {
    matrix: translate(b.x, b.y),
    width: b.width,
    height: b.height,
    resizable: false,
    rotatable: false,
  };
}

export interface HandlePoint {
  kind: HandleKind;
  screen: Point;
}

/** Screen positions of all handles that apply to the frame. */
export function handlePoints(frame: SelectionFrame, camera: Camera): HandlePoint[] {
  const toScreen = (x: number, y: number): Point =>
    camera.worldToScreen(applyToPoint(frame.matrix, { x, y }));
  const out: HandlePoint[] = [];
  if (frame.resizable) {
    for (const kind of HANDLE_ORDER) {
      const [fx, fy] = HANDLE_FRACTION[kind];
      out.push({ kind, screen: toScreen(fx * frame.width, fy * frame.height) });
    }
  }
  if (frame.rotatable) {
    const top = toScreen(frame.width / 2, 0);
    // Outward direction = the box's -y axis (camera has no rotation).
    const c = frame.matrix[2];
    const d = frame.matrix[3];
    const len = Math.hypot(c, d) || 1;
    out.push({
      kind: 'rotate',
      screen: {
        x: top.x + (-c / len) * ROTATE_HANDLE_OFFSET,
        y: top.y + (-d / len) * ROTATE_HANDLE_OFFSET,
      },
    });
  }
  return out;
}

/** The handle under a screen point, preferring the one nearest the pointer. */
export function hitHandle(
  frame: SelectionFrame,
  camera: Camera,
  screen: Point,
  radius = 8,
): HandleKind | null {
  let best: HandleKind | null = null;
  let bestD = radius;
  for (const h of handlePoints(frame, camera)) {
    const dist = Math.hypot(h.screen.x - screen.x, h.screen.y - screen.y);
    if (dist <= bestD) {
      best = h.kind;
      bestD = dist;
    }
  }
  return best;
}
