import { ROOT_ID, SceneDocument } from '../model/document';
import { CONTAINER_TYPES, type NodeId, type SceneNode } from '../model/types';
import { between } from './fractional';

/** Lamport timestamp; total order by (counter, replica). */
export interface Stamp {
  readonly c: number;
  readonly r: string;
}

export function compareStamps(a: Stamp, b: Stamp): number {
  return a.c !== b.c ? a.c - b.c : a.r < b.r ? -1 : a.r > b.r ? 1 : 0;
}

/** Reserved register keys; every other key is a node property (x, fill, text, ...). */
export const TYPE_KEY = '$type';
export const PARENT_KEY = '$parent';
export const DELETED_KEY = '$deleted';

export interface ParentValue {
  readonly parent: NodeId;
  /** Fractional-index sort key among siblings. */
  readonly pos: string;
}

/**
 * The only operation: write `value` into register `key` of node `id` at `stamp`.
 * Because a register keeps the write with the greatest stamp, applying ops is
 * commutative, associative and idempotent, so replicas converge under any
 * delivery order, duplication or delay, with no causal-delivery requirement.
 */
export interface Op {
  readonly id: NodeId;
  readonly key: string;
  readonly value: unknown;
  readonly stamp: Stamp;
}

interface Register {
  value: unknown;
  stamp: Stamp;
}

type Entry = Map<string, Register>;

/** Properties that are structure, not LWW data. */
const STRUCTURAL = new Set(['id', 'type', 'parentId', 'children']);

/**
 * One replica of a collaborative document. Local edits produce `Op`s to send to
 * peers; `apply` merges ops from anyone. `toDocument` materializes the winning
 * state as a `SceneDocument`.
 *
 * Semantics:
 * - Properties are last-writer-wins per (node, property); concurrent edits of
 *   different properties of one node both survive.
 * - Deletion is a tombstone register, so a later undelete (newer stamp) wins and
 *   a concurrent edit never resurrects a deleted node by accident. Descendants
 *   of a tombstoned node are hidden with it.
 * - Order is by fractional index, ties broken by node id, so concurrent inserts
 *   at the same spot never interleave unpredictably.
 * - Concurrent moves that would form a cycle are resolved deterministically:
 *   the smallest id on each cycle is attached to the root.
 */
export class Replica {
  readonly id: string;
  private clock = 0;
  private seq = 0;
  private readonly entries = new Map<NodeId, Entry>();

  constructor(id: string) {
    this.id = id;
  }

  // ---- merging ---------------------------------------------------------

  /** Merges a (local or remote) op. Returns whether it changed the state. */
  apply(op: Op): boolean {
    this.clock = Math.max(this.clock, op.stamp.c);
    let entry = this.entries.get(op.id);
    if (!entry) {
      entry = new Map();
      this.entries.set(op.id, entry);
    }
    const cur = entry.get(op.key);
    if (cur && compareStamps(cur.stamp, op.stamp) >= 0) return false;
    entry.set(op.key, { value: op.value, stamp: op.stamp });
    return true;
  }

  applyAll(ops: readonly Op[]): void {
    for (const op of ops) this.apply(op);
  }

  // ---- local edits (each returns the ops to broadcast) -----------------

  private write(id: NodeId, key: string, value: unknown): Op {
    this.clock += 1;
    const op: Op = { id, key, value, stamp: { c: this.clock, r: this.id } };
    this.apply(op);
    return op;
  }

  /** Creates a node under `parentId` at child index `index` (default: top). */
  create(
    type: SceneNode['type'],
    props: Record<string, unknown> = {},
    parentId: NodeId = ROOT_ID,
    index?: number,
  ): { id: NodeId; ops: Op[] } {
    this.seq += 1;
    const id = `${this.id}:${this.seq}`;
    return { id, ops: this.put(id, type, props, parentId, index) };
  }

  /**
   * Writes a node with a caller-chosen id (used when mirroring a local document
   * whose ids are already unique). If the node was tombstoned it is restored,
   * which is what undoing a delete needs.
   */
  put(
    id: NodeId,
    type: SceneNode['type'],
    props: Record<string, unknown>,
    parentId: NodeId = ROOT_ID,
    index?: number,
  ): Op[] {
    const slot = this.slot(parentId, index, id);
    const ops: Op[] = [];
    if (this.isDeleted(id)) ops.push(this.write(id, DELETED_KEY, false));
    ops.push(this.write(id, TYPE_KEY, type), this.write(id, PARENT_KEY, slot));
    for (const [k, v] of Object.entries(props)) {
      if (!STRUCTURAL.has(k)) ops.push(this.write(id, k, v));
    }
    return ops;
  }

  isDeleted(id: NodeId): boolean {
    return this.entries.get(id)?.get(DELETED_KEY)?.value === true;
  }

  /** True once any op for a node other than the root has been merged. */
  get isEmpty(): boolean {
    return this.entries.size === 0;
  }

  set(id: NodeId, props: Record<string, unknown>): Op[] {
    const ops: Op[] = [];
    for (const [k, v] of Object.entries(props)) {
      if (!STRUCTURAL.has(k)) ops.push(this.write(id, k, v));
    }
    return ops;
  }

  move(id: NodeId, parentId: NodeId, index?: number): Op[] {
    return [this.write(id, PARENT_KEY, this.slot(parentId, index, id))];
  }

  remove(id: NodeId): Op[] {
    return [this.write(id, DELETED_KEY, true)];
  }

  restore(id: NodeId): Op[] {
    return [this.write(id, DELETED_KEY, false)];
  }

  /** Sort key for inserting `movingId` at `index` among `parentId`'s visible children. */
  private slot(parentId: NodeId, index: number | undefined, movingId: NodeId): ParentValue {
    // Nodes whose parent write hasn't arrived yet have no sort key; they can't bound a slot.
    const sibs = this.orderedChildren(parentId).filter((s) => s.id !== movingId && s.pos !== '');
    const at = index === undefined ? sibs.length : Math.max(0, Math.min(index, sibs.length));
    const before = at > 0 ? (sibs[at - 1] as { pos: string }).pos : null;
    // Concurrent inserts can leave equal keys; skip past them so the new key still fits.
    let next = at;
    while (before !== null && next < sibs.length && (sibs[next] as { pos: string }).pos <= before)
      next += 1;
    const after = next < sibs.length ? (sibs[next] as { pos: string }).pos : null;
    const pos = between(before, after);
    return { parent: parentId, pos };
  }

  private posOf(id: NodeId): string {
    return (this.entries.get(id)?.get(PARENT_KEY)?.value as ParentValue | undefined)?.pos ?? '';
  }

  private orderedChildren(parentId: NodeId): { id: NodeId; pos: string }[] {
    const tree = this.resolve();
    return (tree.children.get(parentId) ?? []).map((id) => ({
      id,
      pos: this.posOf(id),
    }));
  }

  // ---- reading ---------------------------------------------------------

  /** Number of distinct nodes ever seen (including tombstones). */
  get nodeCount(): number {
    return this.entries.size;
  }

  /** All register writes currently winning; replaying them rebuilds this state. */
  snapshot(): Op[] {
    const ops: Op[] = [];
    for (const [id, entry] of this.entries) {
      for (const [key, reg] of entry) ops.push({ id, key, value: reg.value, stamp: reg.stamp });
    }
    return ops;
  }

  private isLive(entry: Entry | undefined): boolean {
    return !!entry && entry.has(TYPE_KEY) && entry.get(DELETED_KEY)?.value !== true;
  }

  /** Visible tree: effective parent of every node and ordered child lists. */
  private resolve(): { parent: Map<NodeId, NodeId>; children: Map<NodeId, NodeId[]> } {
    const parent = new Map<NodeId, NodeId>();
    for (const [id, entry] of this.entries) {
      if (id === ROOT_ID || !this.isLive(entry)) continue;
      const p = (entry.get(PARENT_KEY)?.value as ParentValue | undefined)?.parent ?? ROOT_ID;
      parent.set(id, p);
    }
    // A parent must be a live container; otherwise the node is hidden with it.
    const visible = new Map<NodeId, boolean>();
    const isVisible = (id: NodeId, seen: Set<NodeId>): boolean => {
      if (id === ROOT_ID) return true;
      const known = visible.get(id);
      if (known !== undefined) return known;
      const p = parent.get(id);
      if (p === undefined || seen.has(id)) return false;
      seen.add(id);
      const pe = this.entries.get(p);
      const ok =
        p === ROOT_ID ||
        (this.isLive(pe) &&
          CONTAINER_TYPES.has(pe?.get(TYPE_KEY)?.value as SceneNode['type']) &&
          isVisible(p, seen));
      visible.set(id, ok);
      return ok;
    };
    // Break cycles first: attach the smallest id of each cycle to the root.
    for (const start of [...parent.keys()].sort()) {
      const path: NodeId[] = [];
      const on = new Set<NodeId>();
      let cur: NodeId | undefined = start;
      while (cur !== undefined && cur !== ROOT_ID && !on.has(cur)) {
        on.add(cur);
        path.push(cur);
        cur = parent.get(cur);
      }
      if (cur !== undefined && cur !== ROOT_ID && on.has(cur)) {
        const cycle = path.slice(path.indexOf(cur));
        parent.set(
          cycle.reduce((m, n) => (n < m ? n : m)),
          ROOT_ID,
        );
      }
    }
    const children = new Map<NodeId, NodeId[]>();
    for (const id of parent.keys()) {
      if (!isVisible(id, new Set())) continue;
      const p = parent.get(id) as NodeId;
      let list = children.get(p);
      if (!list) children.set(p, (list = []));
      list.push(id);
    }
    for (const list of children.values()) {
      list.sort((a, b) => {
        const pa = this.posOf(a);
        const pb = this.posOf(b);
        return pa < pb ? -1 : pa > pb ? 1 : a < b ? -1 : a > b ? 1 : 0;
      });
    }
    return { parent, children };
  }

  /** Materializes the converged state into a fresh `SceneDocument`. */
  toDocument(): SceneDocument {
    const doc = new SceneDocument();
    const { children } = this.resolve();
    const build = (parentId: NodeId): void => {
      for (const id of children.get(parentId) ?? []) {
        const entry = this.entries.get(id) as Entry;
        const props: Record<string, unknown> = { id };
        for (const [k, reg] of entry) if (!k.startsWith('$')) props[k] = reg.value;
        doc.add(entry.get(TYPE_KEY)?.value as SceneNode['type'], props as never, parentId);
        build(id);
      }
    };
    build(ROOT_ID);
    return doc;
  }
}

/** Canonical dump of a replica's visible document, for equality checks. */
export function dumpDocument(doc: SceneDocument): string {
  return JSON.stringify([...doc.paintOrder()]);
}
