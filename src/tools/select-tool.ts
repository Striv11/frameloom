import type { SceneDocument } from '../model/document';
import type { History, Op } from '../model/history';
import { IDENTITY, type Matrix, type Point, type Rect } from '../model/matrix';
import type { NodeId } from '../model/types';
import type { Camera } from '../render/camera';
import type { SceneIndex } from '../spatial/scene-index';
import { hitHandle, selectionFrame, type SelectionFrame } from './handles';
import { marqueeSelect, pickAt, Selection, topLevelOnly } from './selection';
import { movePatch, resizePatch, rotatePatch, type Box, type ResizeHandle } from './transform';

export interface Modifiers {
  shift: boolean;
}

interface Snapshot {
  id: NodeId;
  box: Box;
  parentWorld: Matrix;
}

type Drag =
  | { kind: 'move'; origin: Point; items: Snapshot[] }
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
      this.drag = {
        kind: 'move',
        origin: world,
        items: topLevelOnly(this.doc, this.selection.ids).map((id) => this.snapshot(id)),
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
        const delta = { x: world.x - drag.origin.x, y: world.y - drag.origin.y };
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
    for (const s of items) {
      const n = this.doc.find(s.id);
      if (!n) continue;
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
