import {
  IDENTITY,
  multiply,
  rotate,
  transformRectBounds,
  translate,
  unionRect,
  type Matrix,
  type Rect,
} from './matrix';
import { CONTAINER_TYPES, type NodeId, type SceneNode } from './types';

export const ROOT_ID: NodeId = 'root';

/** Distributes `Partial` over the union so `update` stays type-safe per node kind. */
type DistributivePartial<T> = T extends unknown ? Partial<Omit<T, 'id' | 'type'>> : never;
export type NodePatch = DistributivePartial<SceneNode>;

const BASE_DEFAULTS = {
  name: '',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  visible: true,
  locked: false,
  opacity: 1,
  fill: '#d9d9d9',
  stroke: null,
  strokeWidth: 1,
} as const;

type NodeInit<T extends SceneNode> = Partial<Omit<T, 'id' | 'type' | 'parentId' | 'children'>>;

/**
 * The scene graph: a flat id -> node table with parent/children links.
 * The root is a frame-like container that is never rendered itself.
 */
export class SceneDocument {
  private readonly nodes = new Map<NodeId, SceneNode>();
  private counter = 0;

  constructor() {
    this.nodes.set(ROOT_ID, {
      ...BASE_DEFAULTS,
      id: ROOT_ID,
      type: 'group',
      name: 'Document',
      fill: null,
      parentId: null,
      children: [],
    });
  }

  get root(): SceneNode {
    return this.get(ROOT_ID);
  }

  get size(): number {
    return this.nodes.size - 1;
  }

  has(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  get(id: NodeId): SceneNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    return node;
  }

  find(id: NodeId): SceneNode | undefined {
    return this.nodes.get(id);
  }

  /** Creates a node of `type` and appends (or inserts at `index`) into `parentId`. */
  add<T extends SceneNode['type']>(
    type: T,
    init: NodeInit<Extract<SceneNode, { type: T }>> & { id?: NodeId } = {},
    parentId: NodeId = ROOT_ID,
    index?: number,
  ): Extract<SceneNode, { type: T }> {
    const parent = this.get(parentId);
    if (!CONTAINER_TYPES.has(parent.type)) throw new Error(`Node ${parentId} cannot have children`);
    const { id: givenId, ...rest } = init;
    const id = givenId ?? this.nextId();
    if (this.nodes.has(id)) throw new Error(`Duplicate node id: ${id}`);
    const node = {
      ...BASE_DEFAULTS,
      ...typeDefaults(type),
      name: `${type[0]?.toUpperCase()}${type.slice(1)} ${this.counter}`,
      ...rest,
      id,
      type,
      parentId,
      children: [],
    } as unknown as Extract<SceneNode, { type: T }>;
    this.nodes.set(id, node);
    this.insertChild(parent, id, index);
    return node;
  }

  update(id: NodeId, patch: NodePatch): void {
    if (id === ROOT_ID) throw new Error('Cannot modify the root node');
    Object.assign(this.get(id), patch);
  }

  /** Removes a node and its whole subtree. Returns the removed ids. */
  remove(id: NodeId): NodeId[] {
    if (id === ROOT_ID) throw new Error('Cannot remove the root node');
    const node = this.get(id);
    const removed: NodeId[] = [];
    this.detach(node);
    const stack = [id];
    while (stack.length) {
      const next = stack.pop() as NodeId;
      const n = this.get(next);
      stack.push(...n.children);
      this.nodes.delete(next);
      removed.push(next);
    }
    return removed;
  }

  /** Moves a node under `parentId` at `index` (default: top). Rejects cycles. */
  reparent(id: NodeId, parentId: NodeId, index?: number): void {
    if (id === ROOT_ID) throw new Error('Cannot move the root node');
    const node = this.get(id);
    const parent = this.get(parentId);
    if (!CONTAINER_TYPES.has(parent.type)) throw new Error(`Node ${parentId} cannot have children`);
    if (this.isAncestorOrSelf(id, parentId)) throw new Error('Cannot move a node into itself');
    this.detach(node);
    node.parentId = parentId;
    this.insertChild(parent, id, index);
  }

  isAncestorOrSelf(ancestorId: NodeId, id: NodeId): boolean {
    for (let cur: NodeId | null = id; cur !== null; cur = this.get(cur).parentId) {
      if (cur === ancestorId) return true;
    }
    return false;
  }

  /** Local matrix: translate to position, then rotate about the top-left corner. */
  localMatrix(id: NodeId): Matrix {
    const n = this.get(id);
    const t = translate(n.x, n.y);
    return n.rotation === 0 ? t : multiply(t, rotate(n.rotation));
  }

  /** Local -> world matrix (the root contributes nothing). */
  worldMatrix(id: NodeId): Matrix {
    let m: Matrix = IDENTITY;
    for (let cur: NodeId | null = id; cur !== null && cur !== ROOT_ID;) {
      const n = this.get(cur);
      m = multiply(this.localMatrix(cur), m);
      cur = n.parentId;
    }
    return m;
  }

  /** World-space axis-aligned bounds of the node's own box (ignores children). */
  worldBounds(id: NodeId): Rect {
    const n = this.get(id);
    return transformRectBounds(this.worldMatrix(id), {
      x: 0,
      y: 0,
      width: n.width,
      height: n.height,
    });
  }

  /** World bounds of a node and all its descendants. */
  subtreeBounds(id: NodeId): Rect | null {
    let acc: Rect | null = id === ROOT_ID ? null : this.worldBounds(id);
    for (const child of this.get(id).children) {
      const b = this.subtreeBounds(child);
      if (b) acc = unionRect(acc, b);
    }
    return acc;
  }

  /** Depth-first, bottom-to-top paint order (parents before their children). */
  *paintOrder(fromId: NodeId = ROOT_ID): Generator<SceneNode> {
    const node = this.get(fromId);
    if (fromId !== ROOT_ID) yield node;
    for (const child of node.children) yield* this.paintOrder(child);
  }

  private nextId(): NodeId {
    let id: NodeId;
    do {
      this.counter += 1;
      id = `n${this.counter}`;
    } while (this.nodes.has(id));
    return id;
  }

  private insertChild(parent: SceneNode, id: NodeId, index?: number): void {
    const at =
      index === undefined ? parent.children.length : clamp(index, 0, parent.children.length);
    parent.children.splice(at, 0, id);
  }

  private detach(node: SceneNode): void {
    if (node.parentId === null) return;
    const parent = this.get(node.parentId);
    const i = parent.children.indexOf(node.id);
    if (i >= 0) parent.children.splice(i, 1);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function typeDefaults(type: SceneNode['type']): Record<string, unknown> {
  switch (type) {
    case 'frame':
      return { fill: '#ffffff', cornerRadius: 0, clip: true, width: 400, height: 300 };
    case 'group':
      return { fill: null };
    case 'rect':
      return { cornerRadius: 0 };
    case 'line':
      return { fill: null, stroke: '#1e1e1e', strokeWidth: 2 };
    case 'path':
      return { fill: null, stroke: '#1e1e1e', strokeWidth: 2, anchors: [], closed: false };
    case 'text':
      return {
        fill: '#1e1e1e',
        text: 'Text',
        fontSize: 16,
        fontFamily: 'Inter, system-ui, sans-serif',
        height: 20,
      };
    default:
      return {};
  }
}
