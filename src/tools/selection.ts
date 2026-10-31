import { ROOT_ID, type SceneDocument } from '../model/document';
import { rectsIntersect, type Point, type Rect } from '../model/matrix';
import type { SceneIndex } from '../spatial/scene-index';
import type { NodeId } from '../model/types';

/** An ordered set of selected node ids. */
export class Selection {
  private set = new Set<NodeId>();

  get ids(): NodeId[] {
    return [...this.set];
  }
  get size(): number {
    return this.set.size;
  }
  has(id: NodeId): boolean {
    return this.set.has(id);
  }
  replace(ids: Iterable<NodeId>): void {
    this.set = new Set(ids);
  }
  add(id: NodeId): void {
    this.set.add(id);
  }
  remove(id: NodeId): void {
    this.set.delete(id);
  }
  toggle(id: NodeId): void {
    if (!this.set.delete(id)) this.set.add(id);
  }
  clear(): void {
    this.set.clear();
  }
  /** Drops ids that no longer exist in the document. */
  prune(doc: SceneDocument): void {
    for (const id of this.set) if (!doc.has(id)) this.set.delete(id);
  }
}

/** Removes ids that have an ancestor in the list (moving both would move the child twice). */
export function topLevelOnly(doc: SceneDocument, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    for (let p = doc.get(id).parentId; p !== null; p = doc.get(p).parentId) {
      if (set.has(p)) return false;
    }
    return true;
  });
}

/** Climbs to the outermost group containing `id` (groups select as a unit; frames don't). */
export function selectionTarget(doc: SceneDocument, id: NodeId): NodeId {
  let target = id;
  for (let p = doc.get(id).parentId; p !== null && p !== ROOT_ID; p = doc.get(p).parentId) {
    if (doc.get(p).type === 'group') target = p;
  }
  return target;
}

/** Topmost selectable node under a world point, with group climbing applied. */
export function pickAt(
  doc: SceneDocument,
  index: SceneIndex,
  p: Point,
  tolerance = 0,
): NodeId | null {
  const hit = index.hitTest(p, tolerance);
  return hit ? selectionTarget(doc, hit) : null;
}

function selectable(doc: SceneDocument, id: NodeId): boolean {
  for (let cur: NodeId | null = id; cur !== null && cur !== ROOT_ID; cur = doc.get(cur).parentId) {
    const n = doc.get(cur);
    if (!n.visible || n.locked) return false;
  }
  return true;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Nodes picked by a marquee: anything whose bounds touch the rectangle, except
 * frames, which must be fully enclosed (otherwise dragging inside a frame would
 * always select the frame). Nodes in groups resolve to their group.
 */
export function marqueeSelect(doc: SceneDocument, index: SceneIndex, rect: Rect): NodeId[] {
  const out = new Set<NodeId>();
  for (const id of index.query(rect)) {
    if (!selectable(doc, id)) continue;
    const n = doc.get(id);
    if (!rectsIntersect(doc.worldBounds(id), rect)) continue;
    if (n.type === 'frame' && !contains(rect, doc.worldBounds(id))) continue;
    out.add(selectionTarget(doc, id));
  }
  return topLevelOnly(doc, [...out]);
}
