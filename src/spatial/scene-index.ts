import { ROOT_ID, type SceneDocument } from '../model/document';
import { applyToPoint, invert, type Point, type Rect } from '../model/matrix';
import type { NodeId } from '../model/types';

import { RTree } from './rtree';

/**
 * Spatial index over a SceneDocument: world-space AABBs in an R-tree plus
 * a paint-order rank so hit tests can return the topmost shape.
 * Call `rebuild()` after structural changes; use `refresh(id)` for moved nodes
 * (its descendants must be refreshed too if their world matrix changed).
 */
export class SceneIndex {
  readonly tree = new RTree();
  private rank = new Map<NodeId, number>();

  constructor(private readonly doc: SceneDocument) {
    this.rebuild();
  }

  rebuild(): void {
    const items: { id: NodeId; rect: Rect }[] = [];
    this.rank = new Map();
    let i = 0;
    for (const n of this.doc.paintOrder()) {
      this.rank.set(n.id, i++);
      items.push({ id: n.id, rect: this.doc.worldBounds(n.id) });
    }
    this.tree.load(items);
  }

  /** Recompute the bounds of one node and its descendants. */
  refresh(id: NodeId): void {
    if (id === ROOT_ID) return this.rebuild();
    for (const n of this.doc.paintOrder(id)) this.tree.update(n.id, this.doc.worldBounds(n.id));
  }

  /** Ids whose world bounds intersect `rect`, in paint order (bottom first). */
  query(rect: Rect): NodeId[] {
    return this.tree.search(rect).sort((a, b) => this.order(a) - this.order(b));
  }

  /**
   * Topmost visible, unlocked node under the world-space point, or null.
   * Tests the node's true (possibly rotated) box; ellipses use their inscribed shape.
   */
  hitTest(p: Point, tolerance = 0): NodeId | null {
    const candidates = this.tree.hitPoint(p, tolerance);
    candidates.sort((a, b) => this.order(b) - this.order(a));
    for (const id of candidates) {
      const n = this.doc.get(id);
      if (!n.visible || n.locked || this.hiddenByAncestor(id)) continue;
      const inv = invert(this.doc.worldMatrix(id));
      if (!inv) continue;
      const q = applyToPoint(inv, p);
      if (n.type === 'ellipse') {
        const rx = n.width / 2 + tolerance;
        const ry = n.height / 2 + tolerance;
        if (rx <= 0 || ry <= 0) continue;
        const dx = (q.x - n.width / 2) / rx;
        const dy = (q.y - n.height / 2) / ry;
        if (dx * dx + dy * dy <= 1) return id;
      } else if (
        q.x >= -tolerance &&
        q.y >= -tolerance &&
        q.x <= n.width + tolerance &&
        q.y <= n.height + tolerance
      ) {
        return id;
      }
    }
    return null;
  }

  private order(id: NodeId): number {
    return this.rank.get(id) ?? -1;
  }

  private hiddenByAncestor(id: NodeId): boolean {
    for (let pid = this.doc.get(id).parentId; pid && pid !== ROOT_ID;) {
      const a = this.doc.get(pid);
      if (!a.visible || a.locked) return true;
      pid = a.parentId;
    }
    return false;
  }
}
