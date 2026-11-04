import { ROOT_ID, type NodePatch, type SceneDocument } from '../model/document';
import { snapshotSubtree, type History, type Op } from '../model/history';
import {
  invert,
  multiply,
  transformRectBounds,
  unionRect,
  type Matrix,
  type Rect,
} from '../model/matrix';
import type { NodeId } from '../model/types';
import { topLevelOnly } from './selection';

/** Splits a rotation+translation matrix into the x/y/rotation a node stores. */
function placementFromMatrix(m: Matrix): { x: number; y: number; rotation: number } {
  // `+ 0` turns -0 into 0 so patches compare cleanly.
  return { x: m[4] + 0, y: m[5] + 0, rotation: Math.atan2(m[1], m[0]) + 0 };
}

/**
 * The x/y/rotation `id` needs inside `parentId` so its world transform is unchanged.
 * Exact because nodes only translate and rotate (no scale or skew exists in the model).
 */
export function placementIn(
  doc: SceneDocument,
  id: NodeId,
  parentId: NodeId,
): { x: number; y: number; rotation: number } {
  const inv = invert(doc.worldMatrix(parentId));
  if (!inv) throw new Error(`Parent ${parentId} has a singular transform`);
  return placementFromMatrix(multiply(inv, doc.worldMatrix(id)));
}

/** Patch for `id` to keep its world transform under a new parent, or `null` if unchanged. */
export function keepWorldPatch(doc: SceneDocument, id: NodeId, parentId: NodeId): NodePatch | null {
  const n = doc.get(id);
  const p = placementIn(doc, id, parentId);
  const eps = 1e-9;
  if (
    Math.abs(p.x - n.x) < eps &&
    Math.abs(p.y - n.y) < eps &&
    Math.abs(p.rotation - n.rotation) < eps
  ) {
    return null;
  }
  return p;
}

function uniqueId(doc: SceneDocument): NodeId {
  let i = doc.size + 1;
  while (doc.has(`g${i}`)) i++;
  return `g${i}`;
}

/** Position of a node in document paint order (used to keep stacking when grouping). */
function paintIndex(doc: SceneDocument): Map<NodeId, number> {
  const order = new Map<NodeId, number>();
  let i = 0;
  for (const n of doc.paintOrder()) order.set(n.id, i++);
  return order;
}

/**
 * Wraps the given nodes in a new group as one undo step. The group sits in the parent of the
 * topmost node at that node's stacking position; members keep their relative order and world
 * transform. Returns the new group id, or `null` if there is nothing to group.
 */
export function groupNodes(
  doc: SceneDocument,
  history: History,
  ids: readonly NodeId[],
): NodeId | null {
  const valid = ids.filter((id) => id !== ROOT_ID && doc.has(id));
  const members = topLevelOnly(doc, valid);
  if (members.length === 0) return null;
  const order = paintIndex(doc);
  members.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const top = doc.get(members[members.length - 1] as NodeId);
  const parentId = top.parentId ?? ROOT_ID;
  const parentInv = invert(doc.worldMatrix(parentId));
  if (!parentInv) return null;

  // Bounds of the members in the parent's local space.
  let box: Rect | null = null;
  for (const id of members) {
    const n = doc.get(id);
    const m = multiply(parentInv, doc.worldMatrix(id));
    box = unionRect(box, transformRectBounds(m, { x: 0, y: 0, width: n.width, height: n.height }));
  }
  if (!box) return null;

  // Insert just above `top` while members are still in place; they are lifted out afterwards,
  // which leaves the group exactly at the topmost member's stacking position.
  const at = doc.get(parentId).children.indexOf(top.id) + 1;
  const gid = uniqueId(doc);
  const group = doc.add(
    'group',
    { id: gid, name: 'Group', x: box.x, y: box.y, width: box.width, height: box.height },
    parentId,
    at,
  );
  const addOp = snapshotSubtree(doc, group.id);
  // Compute child placements while the group exists (so its transform is in the chain).
  const ops: Op[] = [];
  members.forEach((id, i) => {
    const patch = keepWorldPatch(doc, id, gid);
    ops.push({ kind: 'reparent', id, parentId: gid, index: i });
    if (patch) ops.push({ kind: 'update', id, patch });
  });
  // Roll the live group back; `history.apply` re-creates it as the first op of the batch.
  doc.remove(gid);
  history.apply('Group', { kind: 'batch', ops: [addOp, ...ops] });
  return gid;
}

/**
 * Dissolves groups (frames are left alone), moving children to the group's parent at the
 * group's stacking position with unchanged world transforms. One undo step.
 * Nested selected groups are left intact inside their outer group. Returns the freed children.
 */
export function ungroupNodes(
  doc: SceneDocument,
  history: History,
  ids: readonly NodeId[],
): NodeId[] {
  const groups = topLevelOnly(
    doc,
    ids.filter((id) => id !== ROOT_ID && doc.has(id) && doc.get(id).type === 'group'),
  );
  // Highest paint position first: expanding a group shifts only siblings above it, which
  // have already been handled, so the indexes planned from the current document stay valid.
  const order = paintIndex(doc);
  groups.sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0));
  const freed: NodeId[] = [];
  const ops: Op[] = [];
  for (const gid of groups) {
    const parentId = doc.get(gid).parentId ?? ROOT_ID;
    let at = doc.get(parentId).children.indexOf(gid);
    for (const kid of doc.get(gid).children) {
      const patch = keepWorldPatch(doc, kid, parentId);
      if (patch) ops.push({ kind: 'update', id: kid, patch });
      ops.push({ kind: 'reparent', id: kid, parentId, index: at++ });
      freed.push(kid);
    }
    ops.push({ kind: 'remove', id: gid });
  }
  if (ops.length === 0) return [];
  history.apply('Ungroup', { kind: 'batch', ops });
  return freed;
}
