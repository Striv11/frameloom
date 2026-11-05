import type { SceneDocument } from '../model/document';
import type { History, Op } from '../model/history';
import type { Rect } from '../model/matrix';
import type { NodeId } from '../model/types';
import { movePatch } from './transform';
import { topLevelOnly } from './selection';
import { IDENTITY } from '../model/matrix';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'x' | 'y';

/** Moves node `id` so its world bounds shift by (dx, dy); returns the update patch. */
function shiftPatch(doc: SceneDocument, id: NodeId, dx: number, dy: number) {
  const n = doc.get(id);
  const parentWorld = n.parentId ? doc.worldMatrix(n.parentId) : IDENTITY;
  return movePatch(n, parentWorld, { x: dx, y: dy });
}

function commit(
  doc: SceneDocument,
  history: History,
  label: string,
  moves: { id: NodeId; dx: number; dy: number }[],
): boolean {
  const redo: Op[] = [];
  for (const m of moves) {
    if (Math.abs(m.dx) < 1e-9 && Math.abs(m.dy) < 1e-9) continue;
    redo.push({ kind: 'update', id: m.id, patch: shiftPatch(doc, m.id, m.dx, m.dy) });
  }
  if (redo.length === 0) return false;
  history.apply(label, { kind: 'batch', ops: redo });
  return true;
}

/**
 * Aligns the selection's world bounds. With several nodes they align to the selection's union;
 * a single node aligns to its parent frame (not the unbounded root). Returns true if anything moved.
 */
export function alignNodes(
  doc: SceneDocument,
  history: History,
  ids: readonly NodeId[],
  mode: AlignMode,
): boolean {
  const top = topLevelOnly(doc, ids);
  if (top.length === 0) return false;
  const boxes = top.map((id) => doc.worldBounds(id));
  let bounds: Rect;
  if (top.length === 1) {
    const parent = doc.get(top[0]!).parentId;
    if (!parent || doc.get(parent).type !== 'frame') return false;
    bounds = doc.worldBounds(parent);
  } else {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.width));
    const y1 = Math.max(...boxes.map((b) => b.y + b.height));
    bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  const moves = top.map((id, i) => {
    const b = boxes[i]!;
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = bounds.x - b.x;
    else if (mode === 'right') dx = bounds.x + bounds.width - (b.x + b.width);
    else if (mode === 'hcenter') dx = bounds.x + bounds.width / 2 - (b.x + b.width / 2);
    else if (mode === 'top') dy = bounds.y - b.y;
    else if (mode === 'bottom') dy = bounds.y + bounds.height - (b.y + b.height);
    else dy = bounds.y + bounds.height / 2 - (b.y + b.height / 2);
    return { id, dx, dy };
  });
  return commit(doc, history, 'Align', moves);
}

/**
 * Spreads three or more nodes so the gaps between neighbors along `axis` are equal, keeping the
 * outermost two in place. Returns true if anything moved.
 */
export function distributeNodes(
  doc: SceneDocument,
  history: History,
  ids: readonly NodeId[],
  axis: DistributeAxis,
): boolean {
  const top = topLevelOnly(doc, ids);
  if (top.length < 3) return false;
  const lo = (r: Rect): number => (axis === 'x' ? r.x : r.y);
  const len = (r: Rect): number => (axis === 'x' ? r.width : r.height);
  const items = top.map((id) => ({ id, b: doc.worldBounds(id) })).sort((p, q) => lo(p.b) - lo(q.b));
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const total = lo(last.b) + len(last.b) - lo(first.b);
  const gap = (total - items.reduce((s, i) => s + len(i.b), 0)) / (items.length - 1);
  let cursor = lo(first.b);
  const moves = items.map((it) => {
    const d = cursor - lo(it.b);
    cursor += len(it.b) + gap;
    return { id: it.id, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0 };
  });
  return commit(doc, history, 'Distribute', moves);
}
