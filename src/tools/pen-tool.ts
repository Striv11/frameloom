import type { SceneDocument } from '../model/document';
import { snapshotSubtree, type History } from '../model/history';
import { applyToPoint, invert, type Point } from '../model/matrix';
import { anchor, normalizePath, type PathAnchor } from '../model/path';
import type { NodeId } from '../model/types';
import type { Camera } from '../render/camera';
import type { SceneIndex } from '../spatial/scene-index';

import { frameAt } from './create-tool';

/** Screen distance within which a click on the first anchor closes the path. */
export const CLOSE_RADIUS_PX = 8;
/** Handles shorter than this (screen px) are treated as a plain click (corner). */
const MIN_HANDLE_PX = 3;

interface Session {
  id: NodeId;
  parentId: NodeId;
  /** Anchors in parent-local space; the node stores a normalized copy. */
  anchors: PathAnchor[];
  closed: boolean;
}

/**
 * Pen tool (DOM-free): click adds a corner anchor, click-drag pulls out a
 * symmetric bezier handle, clicking the first anchor closes the path.
 * `finish()` (Enter/Esc/tool switch) commits an open path with >= 2 anchors as
 * one undo step; `cancel()` discards. Coordinates are screen pixels.
 */
export class PenTool {
  private session: Session | null = null;
  /** True between pointerDown and pointerUp when the press added an anchor. */
  private pressing = false;
  private downScreen: Point = { x: 0, y: 0 };

  constructor(
    private readonly doc: SceneDocument,
    private readonly index: SceneIndex,
    private readonly camera: Camera,
    private readonly onCreate: (id: NodeId) => void = () => undefined,
    private readonly onChange: () => void = () => undefined,
    private readonly history: History | null = null,
  ) {}

  /** A path is being drawn (more anchors expected). */
  get active(): boolean {
    return this.session !== null;
  }

  get anchorCount(): number {
    return this.session?.anchors.length ?? 0;
  }

  /** Anchors of the in-progress path in world space, for the overlay. */
  preview(): { anchors: PathAnchor[]; matrix: ReturnType<SceneDocument['worldMatrix']> } | null {
    const s = this.session;
    return s ? { anchors: s.anchors, matrix: this.doc.worldMatrix(s.parentId) } : null;
  }

  pointerDown(screen: Point): void {
    const world = this.camera.screenToWorld(screen);
    this.downScreen = screen;
    if (!this.session) {
      const parentId = frameAt(this.doc, world);
      const node = this.doc.add('path', { anchors: [], closed: false }, parentId);
      this.session = { id: node.id, parentId, anchors: [], closed: false };
    }
    const s = this.session;
    const inv = invert(this.doc.worldMatrix(s.parentId));
    if (!inv) return;
    if (s.anchors.length >= 2 && this.nearFirst(s, screen)) {
      s.closed = true;
      this.sync(s);
      this.pressing = false;
      this.commit();
      return;
    }
    const p = applyToPoint(inv, world);
    const last = s.anchors[s.anchors.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) return;
    s.anchors.push(anchor(p.x, p.y));
    this.pressing = true;
    this.sync(s);
  }

  /** While the button is down, drag out the handle of the newest anchor. */
  pointerMove(screen: Point): void {
    const s = this.session;
    if (!s || !this.pressing) return;
    const inv = invert(this.doc.worldMatrix(s.parentId));
    const a = s.anchors[s.anchors.length - 1];
    if (!inv || !a) return;
    const p = applyToPoint(inv, this.camera.screenToWorld(screen));
    const drag = Math.hypot(screen.x - this.downScreen.x, screen.y - this.downScreen.y);
    s.anchors[s.anchors.length - 1] =
      drag < MIN_HANDLE_PX ? anchor(a.x, a.y) : anchor(a.x, a.y, p.x - a.x, p.y - a.y);
    this.sync(s);
  }

  pointerUp(): void {
    this.pressing = false;
  }

  /** Commits an open path (or discards it with fewer than 2 anchors). Returns the id if kept. */
  finish(): NodeId | null {
    if (!this.session) return null;
    this.pressing = false;
    return this.commit();
  }

  cancel(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.pressing = false;
    this.doc.remove(s.id);
    this.index.rebuild();
    this.onChange();
  }

  private commit(): NodeId | null {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    if (s.anchors.length < 2) {
      this.doc.remove(s.id);
      this.index.rebuild();
      this.onChange();
      return null;
    }
    this.history?.record('Draw path', snapshotSubtree(this.doc, s.id), {
      kind: 'remove',
      id: s.id,
    });
    this.onCreate(s.id);
    this.onChange();
    return s.id;
  }

  private nearFirst(s: Session, screen: Point): boolean {
    const first = s.anchors[0];
    if (!first) return false;
    const w = applyToPoint(this.doc.worldMatrix(s.parentId), first);
    const sp = this.camera.worldToScreen(w);
    return Math.hypot(sp.x - screen.x, sp.y - screen.y) <= CLOSE_RADIUS_PX;
  }

  /** Writes the session's anchors to the node in normalized form. */
  private sync(s: Session): void {
    const n = normalizePath(s.anchors, s.closed);
    this.doc.update(s.id, {
      x: n.dx,
      y: n.dy,
      width: n.width,
      height: n.height,
      anchors: n.anchors,
      closed: s.closed,
    });
    this.index.rebuild();
    this.onChange();
  }
}
