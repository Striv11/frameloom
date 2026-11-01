import { ROOT_ID, type SceneDocument } from '../model/document';
import { snapshotSubtree, type History } from '../model/history';
import { applyToPoint, invert, type Point } from '../model/matrix';
import type { NodeId } from '../model/types';
import type { Camera } from '../render/camera';
import type { SceneIndex } from '../spatial/scene-index';
import type { Modifiers } from './select-tool';

export type ShapeKind = 'rect' | 'ellipse' | 'line';

export const TOOL_SHORTCUTS: Readonly<Record<string, 'select' | ShapeKind>> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
};

/** Drags shorter than this many screen pixels are treated as clicks and create nothing. */
const MIN_DRAG_PX = 3;
const LINE_SNAP = Math.PI / 4;

/**
 * Pure geometry of a creation drag in a parent's local space.
 * Rect/ellipse: normalized box; Shift makes it square, growing toward the pointer.
 * Line: from start to end; Shift snaps the angle to 45° keeping the length.
 */
export function shapeBox(
  kind: ShapeKind,
  start: Point,
  end: Point,
  constrain: boolean,
): { x: number; y: number; width: number; height: number } {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (kind === 'line') {
    if (constrain) {
      const len = Math.hypot(dx, dy);
      const a = Math.round(Math.atan2(dy, dx) / LINE_SNAP) * LINE_SNAP;
      dx = Math.cos(a) * len;
      dy = Math.sin(a) * len;
      // Remove float dust such as 6e-15 so axis-aligned lines are exact.
      if (Math.abs(dx) < 1e-9) dx = 0;
      if (Math.abs(dy) < 1e-9) dy = 0;
    }
    return { x: start.x, y: start.y, width: dx, height: dy };
  }
  if (constrain) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

interface CreateDrag {
  id: NodeId;
  parentId: NodeId;
  startLocal: Point;
  startScreen: Point;
}

/**
 * Drag-to-create tool for rectangles, ellipses and lines. The new shape is
 * parented to the topmost un-rotated frame under the pointer (else the root),
 * and appears live during the drag. DOM-free; coordinates are screen pixels.
 */
export class CreateTool {
  private drag: CreateDrag | null = null;

  constructor(
    private readonly doc: SceneDocument,
    private readonly index: SceneIndex,
    private readonly camera: Camera,
    /** Called with the created id when a shape is committed. */
    private readonly onCreate: (id: NodeId) => void = () => undefined,
    private readonly onChange: () => void = () => undefined,
    private readonly history: History | null = null,
  ) {}

  kind: ShapeKind = 'rect';

  get dragging(): boolean {
    return this.drag !== null;
  }

  pointerDown(screen: Point): void {
    const world = this.camera.screenToWorld(screen);
    const parentId = this.parentAt(world);
    const inv = invert(this.doc.worldMatrix(parentId));
    if (!inv) return;
    const startLocal = applyToPoint(inv, world);
    const node = this.doc.add(
      this.kind,
      {
        x: startLocal.x,
        y: startLocal.y,
        width: 0,
        height: 0,
        ...(this.kind === 'line'
          ? { stroke: '#1e1e2e', strokeWidth: 2, fill: null }
          : { fill: '#a29bfe' }),
      },
      parentId,
    );
    this.index.rebuild();
    this.drag = { id: node.id, parentId, startLocal, startScreen: screen };
    this.onChange();
  }

  pointerMove(screen: Point, mods: Modifiers): void {
    const drag = this.drag;
    if (!drag) return;
    const inv = invert(this.doc.worldMatrix(drag.parentId));
    if (!inv) return;
    const end = applyToPoint(inv, this.camera.screenToWorld(screen));
    this.doc.update(drag.id, shapeBox(this.kind, drag.startLocal, end, mods.shift));
    this.index.refresh(drag.id);
    this.onChange();
  }

  /** Commits the shape, or discards it if the drag was too short. Returns the id if kept. */
  pointerUp(screen: Point): NodeId | null {
    const drag = this.drag;
    if (!drag) return null;
    const moved = Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y);
    this.drag = null;
    if (moved < MIN_DRAG_PX) {
      this.discard(drag.id);
      return null;
    }
    this.history?.record(`Create ${this.kind}`, snapshotSubtree(this.doc, drag.id), {
      kind: 'remove',
      id: drag.id,
    });
    this.onCreate(drag.id);
    this.onChange();
    return drag.id;
  }

  cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.discard(drag.id);
  }

  private discard(id: NodeId): void {
    this.doc.remove(id);
    this.index.rebuild();
    this.onChange();
  }

  /** Topmost visible, unlocked, un-rotated frame containing the world point, else the root. */
  private parentAt(world: Point): NodeId {
    let found: NodeId = ROOT_ID;
    for (const n of this.doc.paintOrder()) {
      if (n.type !== 'frame' || !n.visible || n.locked) continue;
      const m = this.doc.worldMatrix(n.id);
      if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9) continue;
      const inv = invert(m);
      if (!inv) continue;
      const q = applyToPoint(inv, world);
      if (q.x >= 0 && q.y >= 0 && q.x <= n.width && q.y <= n.height) found = n.id;
    }
    return found;
  }
}
