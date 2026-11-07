import { ROOT_ID, type NodePatch, type SceneDocument } from '../model/document';
import type { NodeId, SceneNode } from '../model/types';

/** Observer of the edits `reconcile` makes, in the order they are made. */
export interface ReconcileHooks {
  add?(node: SceneNode, parentId: NodeId, index: number): void;
  update?(id: NodeId, patch: Record<string, unknown>): void;
  move?(id: NodeId, parentId: NodeId, index: number): void;
  remove?(id: NodeId): void;
}

const LINKS = new Set(['id', 'type', 'parentId', 'children']);

function dataProps(node: SceneNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) if (!LINKS.has(k)) out[k] = v;
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Edits `target` in place until it equals `source` (same nodes, properties,
 * parents and child order), reporting each edit through `hooks`.
 *
 * Used in both directions of collaboration: with `target` = the live document
 * and `source` = the CRDT's materialized state it applies remote changes; with
 * `target` = a scratch copy of the CRDT state and `source` = the live document
 * the hooks turn local edits into CRDT ops.
 *
 * Nodes are visited top-down, so a node's target parent is already in its final
 * place when the node is moved (no transient cycles). Children that should not
 * survive are pushed behind the wanted ones and removed at the end.
 */
export function reconcile(
  target: SceneDocument,
  source: SceneDocument,
  hooks: ReconcileHooks = {},
): void {
  const wanted = new Set<NodeId>();
  const place = (parentId: NodeId): void => {
    const kids = source.get(parentId).children;
    kids.forEach((id, i) => {
      wanted.add(id);
      const src = source.get(id);
      if (!target.has(id)) {
        target.add(src.type, { ...dataProps(src), id } as never, parentId, i);
        hooks.add?.(src, parentId, i);
      } else {
        const cur = target.get(id);
        const patch: Record<string, unknown> = {};
        const a = dataProps(cur);
        const b = dataProps(src);
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (!same(a[k], b[k])) patch[k] = b[k];
        }
        if (Object.keys(patch).length > 0) {
          target.update(id, patch as NodePatch);
          hooks.update?.(id, patch);
        }
        if (cur.parentId !== parentId || target.get(parentId).children[i] !== id) {
          target.reparent(id, parentId, i);
          hooks.move?.(id, parentId, i);
        }
      }
      place(id);
    });
  };
  place(ROOT_ID);

  // Whatever is left that the source doesn't have; report only subtree roots.
  const extra = [...target.paintOrder()].filter((n) => !wanted.has(n.id));
  const extraIds = new Set(extra.map((n) => n.id));
  for (const n of extra) {
    if (!target.has(n.id)) continue;
    if (n.parentId !== null && extraIds.has(n.parentId)) continue;
    target.remove(n.id);
    hooks.remove?.(n.id);
  }
}
