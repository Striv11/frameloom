import type { Point, Rect } from '../model/matrix';

/**
 * A from-scratch R-tree over axis-aligned rectangles keyed by string id.
 * - `load` bulk-builds with Sort-Tile-Recursive packing.
 * - `insert` picks the child needing least enlargement and splits overfull nodes
 *   along the longer axis of their bounds.
 * - `remove` condenses underfull nodes by reinserting their entries.
 * Rects are touching-inclusive, matching `rectsIntersect`.
 */

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Entry extends Box {
  id: string;
}

interface TNode extends Box {
  leaf: boolean;
  height: number; // leaf = 1
  parent: TNode | null;
  entries: Entry[]; // when leaf
  kids: TNode[]; // when not leaf
}

const MAX = 9;
const MIN = 4;

function toBox(r: Rect): Box {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

function area(b: Box): number {
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}

function enlargement(b: Box, add: Box): number {
  const w = Math.max(b.maxX, add.maxX) - Math.min(b.minX, add.minX);
  const h = Math.max(b.maxY, add.maxY) - Math.min(b.minY, add.minY);
  return w * h - area(b);
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function newNode(leaf: boolean, height: number): TNode {
  return {
    leaf,
    height,
    parent: null,
    entries: [],
    kids: [],
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
}

function recalc(n: TNode): void {
  n.minX = n.minY = Infinity;
  n.maxX = n.maxY = -Infinity;
  for (const c of n.leaf ? n.entries : n.kids) {
    if (c.minX < n.minX) n.minX = c.minX;
    if (c.minY < n.minY) n.minY = c.minY;
    if (c.maxX > n.maxX) n.maxX = c.maxX;
    if (c.maxY > n.maxY) n.maxY = c.maxY;
  }
}

export class RTree {
  private root: TNode = newNode(true, 1);
  private readonly leafOf = new Map<string, TNode>();

  get size(): number {
    return this.leafOf.size;
  }

  has(id: string): boolean {
    return this.leafOf.has(id);
  }

  clear(): void {
    this.root = newNode(true, 1);
    this.leafOf.clear();
  }

  /** Replace the contents with `items` using STR bulk loading. */
  load(items: readonly { id: string; rect: Rect }[]): void {
    this.clear();
    if (items.length === 0) return;
    const seen = new Set<string>();
    const entries: Entry[] = items.map((it) => {
      if (seen.has(it.id)) throw new Error(`Duplicate id in load: ${it.id}`);
      seen.add(it.id);
      return { id: it.id, ...toBox(it.rect) };
    });
    // Build leaves.
    let level: TNode[] = this.pack(entries, true, 1);
    for (const leaf of level) for (const e of leaf.entries) this.leafOf.set(e.id, leaf);
    let height = 1;
    while (level.length > 1) {
      height++;
      level = this.pack(level, false, height);
    }
    this.root = level[0]!;
    this.root.parent = null;
  }

  private pack(items: (Entry | TNode)[], leaf: boolean, height: number): TNode[] {
    const n = items.length;
    const nodeCount = Math.ceil(n / MAX);
    const slices = Math.ceil(Math.sqrt(nodeCount));
    const sliceSize = slices * MAX;
    const cx = (b: Box): number => b.minX + b.maxX;
    const cy = (b: Box): number => b.minY + b.maxY;
    items.sort((a, b) => cx(a) - cx(b));
    const out: TNode[] = [];
    for (let i = 0; i < n; i += sliceSize) {
      const slice = items.slice(i, i + sliceSize).sort((a, b) => cy(a) - cy(b));
      for (let j = 0; j < slice.length; j += MAX) {
        const node = newNode(leaf, height);
        const chunk = slice.slice(j, j + MAX);
        if (leaf) node.entries = chunk as Entry[];
        else {
          node.kids = chunk as TNode[];
          for (const k of node.kids) k.parent = node;
        }
        recalc(node);
        out.push(node);
      }
    }
    return out;
  }

  insert(id: string, rect: Rect): void {
    if (this.leafOf.has(id)) throw new Error(`Duplicate id: ${id}`);
    this.insertEntry({ id, ...toBox(rect) });
  }

  private insertEntry(e: Entry): void {
    let node = this.root;
    while (!node.leaf) {
      let best = node.kids[0]!;
      let bestEnl = Infinity;
      let bestArea = Infinity;
      for (const k of node.kids) {
        const enl = enlargement(k, e);
        const a = area(k);
        if (enl < bestEnl || (enl === bestEnl && a < bestArea)) {
          best = k;
          bestEnl = enl;
          bestArea = a;
        }
      }
      node = best;
    }
    node.entries.push(e);
    this.leafOf.set(e.id, node);
    this.adjustUp(node);
  }

  /** Recompute bounds up the path, splitting overfull nodes. */
  private adjustUp(start: TNode): void {
    let node: TNode | null = start;
    while (node) {
      recalc(node);
      const count = node.leaf ? node.entries.length : node.kids.length;
      if (count > MAX) {
        const sibling = this.split(node);
        if (node.parent) {
          sibling.parent = node.parent;
          node.parent.kids.push(sibling);
        } else {
          const root = newNode(false, node.height + 1);
          root.kids = [node, sibling];
          node.parent = sibling.parent = root;
          recalc(root);
          this.root = root;
          return;
        }
      }
      node = node.parent;
    }
  }

  private split(node: TNode): TNode {
    const items: (Entry | TNode)[] = node.leaf ? node.entries : node.kids;
    const horizontal = node.maxX - node.minX >= node.maxY - node.minY;
    items.sort((a, b) =>
      horizontal ? a.minX + a.maxX - (b.minX + b.maxX) : a.minY + a.maxY - (b.minY + b.maxY),
    );
    const half = Math.ceil(items.length / 2);
    const sibling = newNode(node.leaf, node.height);
    const right = items.splice(half);
    if (node.leaf) {
      node.entries = items as Entry[];
      sibling.entries = right as Entry[];
      for (const e of sibling.entries) this.leafOf.set(e.id, sibling);
    } else {
      node.kids = items as TNode[];
      sibling.kids = right as TNode[];
      for (const k of sibling.kids) k.parent = sibling;
    }
    recalc(node);
    recalc(sibling);
    return sibling;
  }

  /** Remove `id`; returns false if absent. */
  remove(id: string): boolean {
    const leaf = this.leafOf.get(id);
    if (!leaf) return false;
    leaf.entries.splice(
      leaf.entries.findIndex((e) => e.id === id),
      1,
    );
    this.leafOf.delete(id);

    const orphans: Entry[] = [];
    let node: TNode = leaf;
    while (node.parent) {
      const parent: TNode = node.parent;
      const count = node.leaf ? node.entries.length : node.kids.length;
      if (count < MIN) {
        parent.kids.splice(parent.kids.indexOf(node), 1);
        this.collect(node, orphans);
      } else {
        recalc(node);
      }
      node = parent;
    }
    recalc(this.root);
    // Collapse a single-child internal root.
    while (!this.root.leaf && this.root.kids.length === 1) {
      this.root = this.root.kids[0]!;
      this.root.parent = null;
    }
    if (!this.root.leaf && this.root.kids.length === 0) this.root = newNode(true, 1);
    for (const e of orphans) {
      this.leafOf.delete(e.id);
      this.insertEntry(e);
    }
    return true;
  }

  private collect(node: TNode, out: Entry[]): void {
    if (node.leaf) out.push(...node.entries);
    else for (const k of node.kids) this.collect(k, out);
  }

  /** Move/resize an item (inserts if absent). */
  update(id: string, rect: Rect): void {
    this.remove(id);
    this.insert(id, rect);
  }

  /** Ids of all items whose rect intersects `rect` (touching counts). */
  search(rect: Rect): string[] {
    const q = toBox(rect);
    const out: string[] = [];
    if (this.size === 0) return out;
    const stack: TNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!overlaps(n, q)) continue;
      if (n.leaf) {
        for (const e of n.entries) if (overlaps(e, q)) out.push(e.id);
      } else stack.push(...n.kids);
    }
    return out;
  }

  /** Ids of all items whose rect contains `p`, optionally inflated by `tolerance`. */
  hitPoint(p: Point, tolerance = 0): string[] {
    return this.search({
      x: p.x - tolerance,
      y: p.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2,
    });
  }

  /** Throws if structural invariants are violated (used by tests). */
  validate(): void {
    let count = 0;
    const walk = (n: TNode, isRoot: boolean): void => {
      const c = n.leaf ? n.entries.length : n.kids.length;
      if (c > MAX) throw new Error('overfull node');
      if (!isRoot && c === 0) throw new Error('empty node');
      const before = { minX: n.minX, minY: n.minY, maxX: n.maxX, maxY: n.maxY };
      if (c > 0) {
        recalc(n);
        if (
          before.minX !== n.minX ||
          before.minY !== n.minY ||
          before.maxX !== n.maxX ||
          before.maxY !== n.maxY
        )
          throw new Error('stale bounds');
      }
      if (n.leaf) {
        if (n.height !== 1) throw new Error('bad leaf height');
        for (const e of n.entries) {
          if (this.leafOf.get(e.id) !== n) throw new Error('bad leaf map');
          count++;
        }
      } else {
        for (const k of n.kids) {
          if (k.parent !== n) throw new Error('bad parent');
          if (k.height !== n.height - 1) throw new Error('uneven depth');
          walk(k, false);
        }
      }
    };
    walk(this.root, true);
    if (count !== this.leafOf.size) throw new Error('size mismatch');
  }
}
