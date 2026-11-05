import { ROOT_ID, type SceneDocument } from '../model/document';
import type { History, Op } from '../model/history';
import {
  applyToPoint,
  IDENTITY,
  invert,
  type Matrix,
  type Point,
  unionRect,
  type Rect,
} from '../model/matrix';
import type { NodeId } from '../model/types';
import type { Camera } from '../render/camera';
import type { SceneIndex } from '../spatial/scene-index';
import { hitHandle, selectionFrame, type SelectionFrame } from './handles';
import { keepWorldPatch } from './grouping';
import { marqueeSelect, pickAt, Selection, topLevelOnly } from './selection';
import { solveSnap, SNAP_THRESHOLD_PX, type SnapGuide } from './snap';
import { movePatch, resizePatch, rotatePatch, type Box, type ResizeHandle } from './transform';

export interface Modifiers {
  shift: boolean;
  /** Alt/Option held: temporarily disables snapping. */
  alt?: boolean;
}

interface Snapshot {
  id: NodeId;
  box: Box;
  parentWorld: Matrix;
}

type Drag =
  | { kind: 'move'; origin: Point; items: Snapshot[]; last: Point; bounds: Rect }
  | { kind: 'resize'; handle: ResizeHandle; item: Snapshot }
  | { kind: 'rotate'; origin: Point; item: Snapshot }
  | { kind: 'marquee'; origin: Point; base: NodeId[] };

const ROTATE_SNAP = Math.PI / 12;

/**
 * Pointer-driven selection and transform behavior, independent of the DOM so
 * it can be unit tested. Coordinates passed in are screen pixels.
 */
export class SelectTool {
  readonly selection = new Selection();
  /** Marquee rectangle in world space while one is being dragged. */
  marquee: Rect | null = null;
  hover: NodeId | null = null;
  /** Snap guides (world space) while a move is being dragged. */
  guides: SnapGuide[] = [];
  /** Snap moves to sibling edges/centers and equal spacing (8 screen px). */
  snapEnabled = true;
  private drag: Drag | null = null;

  constructor(
    private readonly doc: SceneDocument,
    private readonly index: SceneIndex,
    private readonly camera: Camera,
    private readonly onChange: () => void = () => undefined,
    private readonly history: History | null = null,
  ) {}

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** The selection box with its handles, or null when nothing is selected. */
  frame(): SelectionFrame | null {
    this.selection.prune(this.doc);
    return selectionFrame(this.doc, topLevelOnly(this.doc, this.selection.ids));
  }

  pointerDown(screen: Point, mods: Modifiers): void {
    const world = this.camera.screenToWorld(screen);
    const frame = this.frame();
    if (frame) {
      const handle = hitHandle(frame, this.camera, screen);
      const [id] = this.selection.ids;
      if (handle && id !== undefined && this.selection.size === 1) {
        const item = this.snapshot(id);
        this.drag =
          handle === 'rotate'
            ? { kind: 'rotate', origin: world, item }
            : { kind: 'resize', handle, item };
        return;
      }
    }

    const hit = pickAt(this.doc, this.index, world, 2 / this.camera.zoom);
    if (hit) {
      if (mods.shift && this.selection.has(hit)) {
        this.selection.remove(hit);
        this.onChange();
        return;
      }
      if (mods.shift) this.selection.add(hit);
      else if (!this.selection.has(hit)) this.selection.replace([hit]);
      const items = topLevelOnly(this.doc, this.selection.ids).map((id) => this.snapshot(id));
      let bounds: Rect | null = null;
      for (const s of items) bounds = unionRect(bounds, this.doc.worldBounds(s.id));
      this.drag = {
        kind: 'move',
        origin: world,
        last: world,
        items,
        bounds: bounds ?? { x: 0, y: 0, width: 0, height: 0 },
      };
    } else {
      const base = mods.shift ? this.selection.ids : [];
      this.selection.replace(base);
      this.drag = { kind: 'marquee', origin: world, base };
    }
    this.onChange();
  }

  pointerMove(screen: Point, mods: Modifiers): void {
    const world = this.camera.screenToWorld(screen);
    const drag = this.drag;
    if (!drag) {
      const hit = pickAt(this.doc, this.index, world, 2 / this.camera.zoom);
      if (hit !== this.hover) {
        this.hover = hit;
        this.onChange();
      }
      return;
    }
    switch (drag.kind) {
      case 'move': {
        drag.last = world;
        const delta = { x: world.x - drag.origin.x, y: world.y - drag.origin.y };
        this.guides = [];
        if (this.snapEnabled && !mods.alt) {
          const snap = this.snapMove(drag, delta);
          delta.x += snap.dx;
          delta.y += snap.dy;
          this.guides = snap.guides;
        }
        for (const s of drag.items) {
          this.apply(s.id, movePatch(s.box, s.parentWorld, delta));
        }
        break;
      }
      case 'resize': {
        const { item } = drag;
        this.apply(
          item.id,
          resizePatch(item.box, item.parentWorld, drag.handle, world, {
            keepAspect: mods.shift,
          }),
        );
        break;
      }
      case 'rotate': {
        const { item } = drag;
        this.apply(
          item.id,
          rotatePatch(item.box, item.parentWorld, drag.origin, world, {
            snap: mods.shift ? ROTATE_SNAP : 0,
          }),
        );
        break;
      }
      case 'marquee': {
        const x = Math.min(drag.origin.x, world.x);
        const y = Math.min(drag.origin.y, world.y);
        this.marquee = {
          x,
          y,
          width: Math.abs(world.x - drag.origin.x),
          height: Math.abs(world.y - drag.origin.y),
        };
        const picked = marqueeSelect(this.doc, this.index, this.marquee);
        this.selection.replace([...drag.base, ...picked.filter((id) => !drag.base.includes(id))]);
        break;
      }
    }
    this.onChange();
  }

  pointerUp(): void {
    const drag = this.drag;
    if (!drag) return;
    this.commit(drag);
    this.drag = null;
    this.marquee = null;
    this.guides = [];
    this.onChange();
  }

  /** Aborts the current drag and restores the pre-drag geometry. */
  cancel(): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'move') for (const s of drag.items) this.apply(s.id, s.box);
    else if (drag.kind === 'resize' || drag.kind === 'rotate')
      this.apply(drag.item.id, drag.item.box);
    this.pointerUp();
  }

  /** Records a finished move/resize/rotate as one undo step (if anything changed). */
  private commit(drag: Drag): void {
    if (!this.history || drag.kind === 'marquee') return;
    const items = drag.kind === 'move' ? drag.items : [drag.item];
    const redo: Op[] = [];
    const undo: Op[] = [];
    const target =
      drag.kind === 'move' && (drag.last.x !== drag.origin.x || drag.last.y !== drag.origin.y)
        ? this.dropTarget(drag)
        : null;
    for (const s of items) {
      const n = this.doc.find(s.id);
      if (!n) continue;
      const oldParent = n.parentId;
      if (
        target !== null &&
        oldParent !== null &&
        oldParent !== target &&
        this.canReparent(s.id, oldParent)
      ) {
        const oldIndex = this.doc.get(oldParent).children.indexOf(s.id);
        const patch = keepWorldPatch(this.doc, s.id, target);
        this.doc.reparent(s.id, target);
        if (patch) this.doc.update(s.id, patch);
        this.index.refresh(s.id);
        const final = this.doc.get(s.id);
        redo.push(
          { kind: 'reparent', id: s.id, parentId: target },
          {
            kind: 'update',
            id: s.id,
            patch: { x: final.x, y: final.y, rotation: final.rotation },
          },
        );
        undo.unshift(
          { kind: 'update', id: s.id, patch: { x: s.box.x, y: s.box.y, rotation: s.box.rotation } },
          { kind: 'reparent', id: s.id, parentId: oldParent, index: oldIndex },
        );
        continue;
      }
      const after: Partial<Box> = {};
      const before: Partial<Box> = {};
      for (const k of ['x', 'y', 'width', 'height', 'rotation'] as const) {
        if (n[k] !== s.box[k]) {
          after[k] = n[k];
          before[k] = s.box[k];
        }
      }
      if (Object.keys(after).length === 0) continue;
      redo.push({ kind: 'update', id: s.id, patch: after });
      undo.push({ kind: 'update', id: s.id, patch: before });
    }
    if (redo.length === 0) return;
    const label = drag.kind === 'move' ? 'Move' : drag.kind === 'resize' ? 'Resize' : 'Rotate';
    this.history.record(label, { kind: 'batch', ops: redo }, { kind: 'batch', ops: undo });
  }

  /** Only nodes directly in a frame or the root move between containers; group members stay put. */
  private canReparent(id: NodeId, parentId: NodeId): boolean {
    if (id === ROOT_ID) return false;
    return parentId === ROOT_ID || this.doc.get(parentId).type === 'frame';
  }

  /**
   * The frame (or root) under the pointer where a finished move drops its nodes: the topmost
   * visible, unlocked frame containing the point that is not part of the moved selection.
   */
  private dropTarget(drag: Extract<Drag, { kind: 'move' }>): NodeId {
    const moved = drag.items.map((s) => s.id);
    let best: NodeId = ROOT_ID;
    for (const n of this.doc.paintOrder()) {
      if (n.type !== 'frame' || !n.visible || n.locked) continue;
      if (moved.some((m) => this.doc.isAncestorOrSelf(m, n.id))) continue;
      const inv = invert(this.doc.worldMatrix(n.id));
      if (!inv) continue;
      const q = applyToPoint(inv, drag.last);
      if (q.x >= 0 && q.y >= 0 && q.x <= n.width && q.y <= n.height) best = n.id;
    }
    return best;
  }

  /** Snap correction for the moving union box against nearby siblings and the parent frame. */
  private snapMove(drag: Extract<Drag, { kind: 'move' }>, delta: Point) {
    const union: Rect = {
      ...drag.bounds,
      x: drag.bounds.x + delta.x,
      y: drag.bounds.y + delta.y,
    };
    const first = this.doc.get(drag.items[0]!.id);
    const parentId = first.parentId ?? ROOT_ID;
    const moved = new Set(drag.items.map((s) => s.id));
    const reach = (SNAP_THRESHOLD_PX + 240) / this.camera.zoom;
    const area = {
      x: union.x - reach,
      y: union.y - reach,
      width: union.width + 2 * reach,
      height: union.height + 2 * reach,
    };
    const cx = union.x + union.width / 2;
    const cy = union.y + union.height / 2;
    const near = this.index
      .query(area)
      .filter((id) => {
        if (moved.has(id)) return false;
        const n = this.doc.get(id);
        return n.parentId === parentId && n.visible;
      })
      .map((id) => this.doc.worldBounds(id))
      .sort(
        (a, b) =>
          Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) -
          Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy),
      )
      .slice(0, 24);
    if (parentId !== ROOT_ID && this.doc.get(parentId).type === 'frame') {
      near.push(this.doc.worldBounds(parentId));
    }
    return solveSnap(union, near, SNAP_THRESHOLD_PX / this.camera.zoom);
  }

  private snapshot(id: NodeId): Snapshot {
    const n = this.doc.get(id);
    const parentWorld = n.parentId ? this.doc.worldMatrix(n.parentId) : IDENTITY;
    return {
      id,
      parentWorld,
      box: { x: n.x, y: n.y, width: n.width, height: n.height, rotation: n.rotation },
    };
  }

  private apply(id: NodeId, patch: Partial<Box>): void {
    this.doc.update(id, patch);
    this.index.refresh(id);
  }
}
