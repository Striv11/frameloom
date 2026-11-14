import { ROOT_ID, type NodePatch, type SceneDocument } from './document';
import type { NodeId, SceneNode } from './types';

/** A node as stored in an `add` op: everything except live links to children. */
export type NodeSnapshot = Omit<SceneNode, 'children'> & { index: number };

/**
 * An invertible document mutation. `applyOp` executes one and returns the op
 * that exactly undoes it, so history never needs per-kind undo code.
 */
export type Op =
  /** Re-creates nodes in pre-order (parents before children). */
  | { kind: 'add'; nodes: NodeSnapshot[] }
  /** Removes a node and its subtree. */
  | { kind: 'remove'; id: NodeId }
  | { kind: 'update'; id: NodeId; patch: NodePatch }
  | { kind: 'reparent'; id: NodeId; parentId: NodeId; index?: number }
  | { kind: 'batch'; ops: Op[] };

/** Captures `id` and its subtree as an `add` op (pre-order, with sibling indexes). */
export function snapshotSubtree(doc: SceneDocument, id: NodeId): Op {
  const nodes: NodeSnapshot[] = [];
  const visit = (nid: NodeId): void => {
    const { children, ...rest } = doc.get(nid);
    const parent = rest.parentId === null ? null : doc.get(rest.parentId);
    nodes.push({ ...rest, index: parent ? parent.children.indexOf(nid) : 0 } as NodeSnapshot);
    for (const c of children) visit(c);
  };
  visit(id);
  return { kind: 'add', nodes };
}

export function applyOp(doc: SceneDocument, op: Op): Op {
  switch (op.kind) {
    case 'add': {
      for (const n of op.nodes) {
        const { index, type, parentId, ...init } = n;
        doc.add(type, init as never, parentId ?? ROOT_ID, index);
      }
      const first = op.nodes[0];
      if (!first) return { kind: 'batch', ops: [] };
      return { kind: 'remove', id: first.id };
    }
    case 'remove': {
      const inverse = snapshotSubtree(doc, op.id);
      doc.remove(op.id);
      return inverse;
    }
    case 'update': {
      const node = doc.get(op.id) as unknown as Record<string, unknown>;
      const before: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) before[key] = node[key];
      doc.update(op.id, op.patch);
      return { kind: 'update', id: op.id, patch: before as NodePatch };
    }
    case 'reparent': {
      const node = doc.get(op.id);
      const oldParent = node.parentId ?? ROOT_ID;
      const index = doc.get(oldParent).children.indexOf(op.id);
      doc.reparent(op.id, op.parentId, op.index);
      return { kind: 'reparent', id: op.id, parentId: oldParent, index };
    }
    case 'batch': {
      // Inverse of a batch is the inverses in reverse order.
      const inverses = op.ops.map((o) => applyOp(doc, o));
      return { kind: 'batch', ops: inverses.reverse() };
    }
  }
}

/**
 * Like `applyOp`, but skips any step that no longer fits the document (the node
 * was deleted by a remote peer, its new parent is gone, a move would form a
 * cycle, ...) instead of throwing. Returns how many leaf steps took effect.
 * Used by undo/redo so a collaborator's edits can't break or corrupt them.
 */
export function applyOpTolerant(doc: SceneDocument, op: Op): number {
  if (op.kind === 'batch') {
    let n = 0;
    for (const o of op.ops) n += applyOpTolerant(doc, o);
    return n;
  }
  if (op.kind === 'add') {
    let n = 0;
    for (const node of op.nodes) {
      const { index, type, parentId, ...init } = node;
      if (doc.has(node.id)) continue;
      try {
        doc.add(type, init as never, parentId ?? ROOT_ID, index);
        n++;
      } catch {
        // parent missing or no longer a container
      }
    }
    return n;
  }
  try {
    applyOp(doc, op);
    return 1;
  } catch {
    return 0;
  }
}

interface Entry {
  label: string;
  redo: Op;
  undo: Op;
  /** Entries recorded in a row with the same key merge into one undo step. */
  key: string | undefined;
}

/**
 * Undo/redo stack over a `SceneDocument`. Use `apply` to run an op through
 * history, or `record` to log a change a tool already made live (such as a
 * drag), so each gesture is a single undo step.
 */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  /** Blocks coalescing across an undo/redo boundary. */
  private sealed = true;

  constructor(
    private readonly doc: SceneDocument,
    private readonly limit = 500,
    private readonly onChange: () => void = () => undefined,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Executes `op` and records it. */
  apply(label: string, op: Op, key?: string): void {
    const undo = applyOp(this.doc, op);
    this.push({ label, redo: op, undo, key });
  }

  /** Records a change that has already been applied to the document. */
  record(label: string, redo: Op, undo: Op, key?: string): void {
    this.push({ label, redo, undo, key });
  }

  /**
   * Steps over entries a remote edit made impossible (nothing left to change),
   * dropping them, until one takes effect. Returns false if none did.
   */
  undo(): boolean {
    let did = false;
    while (!did) {
      const entry = this.undoStack.pop();
      if (!entry) break;
      if (applyOpTolerant(this.doc, entry.undo) > 0) {
        this.redoStack.push(entry);
        did = true;
      }
    }
    this.sealed = true;
    this.onChange();
    return did;
  }

  /**
   * Steps over entries a remote edit made impossible (nothing left to change),
   * dropping them, until one takes effect. Returns false if none did.
   */
  redo(): boolean {
    let did = false;
    while (!did) {
      const entry = this.redoStack.pop();
      if (!entry) break;
      if (applyOpTolerant(this.doc, entry.redo) > 0) {
        this.undoStack.push(entry);
        did = true;
      }
    }
    this.sealed = true;
    this.onChange();
    return did;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.sealed = true;
    this.onChange();
  }

  private push(entry: Entry): void {
    this.redoStack = [];
    const top = this.undoStack.at(-1);
    if (top && !this.sealed && entry.key !== undefined && top.key === entry.key) {
      // Keep the oldest undo and the newest redo: one step spanning both.
      this.undoStack[this.undoStack.length - 1] = {
        ...top,
        redo: { kind: 'batch', ops: [top.redo, entry.redo] },
        undo: { kind: 'batch', ops: [entry.undo, top.undo] },
      };
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.sealed = false;
    this.onChange();
  }
}
