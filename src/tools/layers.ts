import { ROOT_ID, type SceneDocument } from '../model/document';
import type { History, Op } from '../model/history';
import { CONTAINER_TYPES, type NodeId, type NodeType } from '../model/types';

export interface LayerRow {
  id: NodeId;
  name: string;
  type: NodeType;
  depth: number;
  visible: boolean;
  locked: boolean;
  /** Container with at least one child. */
  expandable: boolean;
  collapsed: boolean;
}

export type DropPlace = 'above' | 'below' | 'inside';

/**
 * Layer rows in panel order: topmost paint first, children right under their parent.
 * `limit` caps the row count so huge documents stay cheap to list.
 */
export function layerRows(
  doc: SceneDocument,
  collapsed: ReadonlySet<NodeId> = new Set(),
  limit = Infinity,
): LayerRow[] {
  const rows: LayerRow[] = [];
  const visit = (parentId: NodeId, depth: number): void => {
    const kids = doc.get(parentId).children;
    for (let i = kids.length - 1; i >= 0 && rows.length < limit; i--) {
      const n = doc.get(kids[i] as NodeId);
      const expandable = n.children.length > 0;
      const isCollapsed = expandable && collapsed.has(n.id);
      rows.push({
        id: n.id,
        name: n.name || n.type,
        type: n.type,
        depth,
        visible: n.visible,
        locked: n.locked,
        expandable,
        collapsed: isCollapsed,
      });
      if (expandable && !isCollapsed) visit(n.id, depth + 1);
    }
  };
  visit(ROOT_ID, 0);
  return rows;
}

/** Renames a layer. Blank names are rejected. Returns whether anything changed. */
export function renameLayer(
  doc: SceneDocument,
  history: History,
  id: NodeId,
  name: string,
): boolean {
  const next = name.trim();
  if (next === '' || !doc.has(id) || id === ROOT_ID || doc.get(id).name === next) return false;
  history.apply('Rename layer', { kind: 'update', id, patch: { name: next } });
  return true;
}

export function setLayerVisible(
  doc: SceneDocument,
  history: History,
  id: NodeId,
  visible: boolean,
): boolean {
  if (!doc.has(id) || id === ROOT_ID || doc.get(id).visible === visible) return false;
  history.apply(visible ? 'Show layer' : 'Hide layer', { kind: 'update', id, patch: { visible } });
  return true;
}

export function setLayerLocked(
  doc: SceneDocument,
  history: History,
  id: NodeId,
  locked: boolean,
): boolean {
  if (!doc.has(id) || id === ROOT_ID || doc.get(id).locked === locked) return false;
  history.apply(locked ? 'Lock layer' : 'Unlock layer', { kind: 'update', id, patch: { locked } });
  return true;
}

const isTranslationOnly = (m: readonly number[]): boolean =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;

/**
 * Plans a drag-drop of `id` relative to `targetId`: the new parent and the child index
 * (counted after `id` is detached), or `null` if the drop is invalid.
 */
function planMove(
  doc: SceneDocument,
  id: NodeId,
  targetId: NodeId,
  place: DropPlace,
): { parentId: NodeId; index: number } | null {
  if (!doc.has(id) || !doc.has(targetId) || id === ROOT_ID || id === targetId) return null;
  if (place === 'inside') {
    if (!CONTAINER_TYPES.has(doc.get(targetId).type) || doc.isAncestorOrSelf(id, targetId))
      return null;
    const kids = doc.get(targetId).children.filter((c) => c !== id);
    return { parentId: targetId, index: kids.length };
  }
  if (targetId === ROOT_ID) return null;
  const parentId = doc.get(targetId).parentId ?? ROOT_ID;
  if (doc.isAncestorOrSelf(id, parentId)) return null;
  const siblings = doc.get(parentId).children.filter((c) => c !== id);
  const at = siblings.indexOf(targetId);
  // Children are stored bottom-to-top, so "above" in the panel means a higher index.
  return { parentId, index: place === 'above' ? at + 1 : at };
}

/**
 * Moves a layer above/below another or into a container, as one undo step. The node keeps
 * its world position; that is only expressible without compensating rotation when neither
 * the old nor the new parent chain is rotated, so other cross-parent moves are refused.
 */
export function moveLayer(
  doc: SceneDocument,
  history: History,
  id: NodeId,
  targetId: NodeId,
  place: DropPlace,
): boolean {
  const plan = planMove(doc, id, targetId, place);
  if (!plan) return false;
  const node = doc.get(id);
  const oldParent = node.parentId ?? ROOT_ID;
  const ops: Op[] = [];
  if (plan.parentId === oldParent) {
    const current = doc.get(oldParent).children.indexOf(id);
    if (current === plan.index) return false;
  } else {
    const from = doc.worldMatrix(oldParent);
    const to = doc.worldMatrix(plan.parentId);
    if (!isTranslationOnly(from) || !isTranslationOnly(to)) return false;
    const dx = from[4] - to[4];
    const dy = from[5] - to[5];
    if (dx !== 0 || dy !== 0) {
      ops.push({ kind: 'update', id, patch: { x: node.x + dx, y: node.y + dy } });
    }
  }
  ops.push({ kind: 'reparent', id, parentId: plan.parentId, index: plan.index });
  history.apply('Move layer', { kind: 'batch', ops });
  return true;
}
