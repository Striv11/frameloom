import { ROOT_ID, type NodePatch, type SceneDocument } from './document';
import { snapshotSubtree, type History, type Op } from './history';
import type { NodeId, SceneNode } from './types';

/**
 * Components and instances.
 *
 * An instance is a frame (`instanceOf` = master id) whose descendants are real
 * nodes that mirror the master's descendants (`sourceId`). They are real so
 * rendering, hit-testing, selection and collaboration need no special cases.
 * Their content is a pure function of the master plus per-node `overrides`, so
 * `syncInstances` re-derives it without going through history: undoing a master
 * edit simply re-derives the instances.
 */

/** Properties an instance may override; everything else follows the master. */
export const OVERRIDABLE: ReadonlySet<string> = new Set([
  'fill',
  'stroke',
  'strokeWidth',
  'opacity',
  'text',
  'fontSize',
  'cornerRadius',
  'visible',
]);

/** Instance-root properties that belong to the instance, never the master. */
const OWN_ROOT = new Set(['x', 'y', 'rotation', 'name', 'locked', 'visible']);
const NEVER_COPIED = new Set([
  'id',
  'type',
  'parentId',
  'children',
  'component',
  'instanceOf',
  'sourceId',
  'overrides',
]);

type Rec = Record<string, unknown>;

/** Clears every instance link (undefined keys are skipped by serialization and equal missing ones). */
const UNLINK = {
  instanceOf: undefined,
  sourceId: undefined,
  overrides: undefined,
} as unknown as NodePatch;

const isInstanceNode = (n: SceneNode): boolean =>
  n.instanceOf !== undefined || n.sourceId !== undefined;

/** `patch` plus an updated `overrides` map when `node` is part of an instance. */
export function withOverrides(node: SceneNode, patch: Rec): Rec {
  if (!isInstanceNode(node)) return patch;
  const keys = Object.keys(patch).filter((k) => OVERRIDABLE.has(k));
  if (keys.length === 0) return patch;
  const overrides = { ...(node.overrides ?? {}) };
  for (const k of keys) overrides[k] = patch[k] as never;
  return { ...patch, overrides };
}

function subtree(doc: SceneDocument, id: NodeId): SceneNode[] {
  return [...doc.paintOrder(id)];
}

/** Turns a plain frame into a component master. Returns false if it can't be one. */
export function makeComponent(doc: SceneDocument, history: History, id: NodeId): boolean {
  if (id === ROOT_ID || !doc.has(id)) return false;
  const node = doc.get(id);
  if (node.type !== 'frame' || node.component || isInstanceNode(node)) return false;
  // No nesting of instances/components inside a master, and not inside an instance.
  if (subtree(doc, id).some((n) => n.id !== id && (isInstanceNode(n) || n.component))) return false;
  for (let p = node.parentId; p !== null; p = doc.get(p).parentId) {
    if (isInstanceNode(doc.get(p))) return false;
  }
  history.apply('Make component', { kind: 'update', id, patch: { component: true } });
  return true;
}

/** Creates an instance of `masterId` next to it. Returns its id, or null. */
export function createInstance(
  doc: SceneDocument,
  history: History,
  masterId: NodeId,
): NodeId | null {
  const master = doc.find(masterId);
  if (!master || !master.component || master.parentId === null) return null;
  const root = doc.add(
    'frame',
    {
      name: `${master.name} instance`,
      x: master.x + master.width + 40,
      y: master.y,
      width: master.width,
      height: master.height,
      fill: master.fill,
      stroke: master.stroke,
      strokeWidth: master.strokeWidth,
      opacity: master.opacity,
      cornerRadius: master.type === 'frame' ? master.cornerRadius : 0,
      clip: master.type === 'frame' ? master.clip : true,
      instanceOf: masterId,
    },
    master.parentId,
  );
  syncInstance(doc, root.id);
  history.record('Create instance', snapshotSubtree(doc, root.id), { kind: 'remove', id: root.id });
  return root.id;
}

/** Whether `id` is an instance root, or part of one. */
export function isInstancePart(doc: SceneDocument, id: NodeId): boolean {
  const n = doc.find(id);
  return n !== undefined && isInstanceNode(n);
}

/** Drops the link to the master: the instance becomes ordinary nodes. One undo step. */
export function detachInstance(doc: SceneDocument, history: History, id: NodeId): boolean {
  let root = doc.find(id);
  while (
    root &&
    root.instanceOf === undefined &&
    root.parentId !== null &&
    root.sourceId !== undefined
  )
    root = doc.find(root.parentId);
  if (!root || root.instanceOf === undefined) return false;
  const ops: Op[] = subtree(doc, root.id)
    .filter(isInstanceNode)
    .map((n) => ({
      kind: 'update',
      id: n.id,
      patch: UNLINK,
    }));
  history.apply('Detach instance', { kind: 'batch', ops });
  return true;
}

/** Master node that `node` mirrors, if any. */
function masterOf(doc: SceneDocument, node: SceneNode): SceneNode | undefined {
  const mid = node.instanceOf ?? node.sourceId;
  return mid === undefined ? undefined : doc.find(mid);
}

/** Drops overrides on `id`'s instance subtree, restoring the master's values. One undo step. */
export function resetOverrides(doc: SceneDocument, history: History, id: NodeId): boolean {
  const ops: Op[] = [];
  for (const n of subtree(doc, id)) {
    if (!n.overrides || Object.keys(n.overrides).length === 0) continue;
    const m = masterOf(doc, n);
    const patch: Rec = { overrides: {} };
    for (const k of Object.keys(n.overrides)) if (m) patch[k] = (m as unknown as Rec)[k];
    ops.push({ kind: 'update', id: n.id, patch: patch as NodePatch });
  }
  if (ops.length === 0) return false;
  history.apply('Reset overrides', { kind: 'batch', ops });
  return true;
}

function applyProps(
  doc: SceneDocument,
  inst: SceneNode,
  master: SceneNode,
  isRoot: boolean,
): boolean {
  const want: Rec = {};
  for (const [k, v] of Object.entries(master)) {
    if (NEVER_COPIED.has(k)) continue;
    if (isRoot && OWN_ROOT.has(k)) continue;
    want[k] = v;
  }
  for (const [k, v] of Object.entries(inst.overrides ?? {})) if (OVERRIDABLE.has(k)) want[k] = v;
  const cur = inst as unknown as Rec;
  const patch: Rec = {};
  for (const [k, v] of Object.entries(want)) {
    if (cur[k] !== v && JSON.stringify(cur[k]) !== JSON.stringify(v)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return false;
  doc.update(inst.id, patch as NodePatch);
  return true;
}

function syncChildren(doc: SceneDocument, master: SceneNode, inst: SceneNode): boolean {
  let changed = false;
  const wanted = new Set(master.children);
  const bySource = new Map<NodeId, NodeId>();
  for (const cid of [...inst.children].sort()) {
    const c = doc.get(cid);
    if (c.sourceId === undefined) continue;
    // Duplicates (e.g. two tabs deriving the same node) collapse deterministically; stale ones go.
    if (!wanted.has(c.sourceId) || bySource.has(c.sourceId)) {
      doc.remove(cid);
      changed = true;
    } else bySource.set(c.sourceId, cid);
  }
  master.children.forEach((mid, i) => {
    const m = doc.get(mid);
    let cid = bySource.get(mid);
    if (cid === undefined) {
      cid = doc.add(m.type, { sourceId: mid } as never, inst.id, i).id;
      changed = true;
    }
    const child = doc.get(cid);
    changed = applyProps(doc, child, m, false) || changed;
    if (doc.get(inst.id).children[i] !== cid) {
      doc.reparent(cid, inst.id, i);
      changed = true;
    }
    if (m.children.length > 0 || child.children.length > 0)
      changed = syncChildren(doc, m, child) || changed;
  });
  return changed;
}

function strip(doc: SceneDocument, id: NodeId): void {
  for (const n of subtree(doc, id)) {
    if (isInstanceNode(n)) doc.update(n.id, UNLINK);
  }
}

/** Re-derives one instance from its master. Returns whether anything changed. */
export function syncInstance(doc: SceneDocument, rootId: NodeId): boolean {
  const inst = doc.find(rootId);
  if (!inst || inst.instanceOf === undefined) return false;
  const master = doc.find(inst.instanceOf);
  if (!master || !master.component) {
    strip(doc, rootId); // master deleted or no longer a component
    return true;
  }
  let changed = applyProps(doc, inst, master, true);
  changed = syncChildren(doc, master, inst) || changed;
  return changed;
}

/** Re-derives every instance in the document (cheap no-op when there are none). */
export function syncInstances(doc: SceneDocument): boolean {
  const roots: NodeId[] = [];
  for (const n of doc.paintOrder()) if (n.instanceOf !== undefined) roots.push(n.id);
  let changed = false;
  for (const id of roots) changed = syncInstance(doc, id) || changed;
  return changed;
}
