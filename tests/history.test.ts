import { describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { applyOp, History, snapshotSubtree, type Op } from '../src/model/history';
import { Camera } from '../src/render/camera';
import { SceneIndex } from '../src/spatial/scene-index';
import { CreateTool } from '../src/tools/create-tool';
import { SelectTool } from '../src/tools/select-tool';

/** Full structural dump (including child order) for equality checks. */
function dump(doc: SceneDocument): string {
  const out: unknown[] = [doc.root];
  for (const n of doc.paintOrder()) out.push(n);
  return JSON.stringify(out);
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('applyOp', () => {
  it('update returns an inverse restoring only the touched keys', () => {
    const doc = new SceneDocument();
    const r = doc.add('rect', { x: 1, y: 2, fill: '#111' });
    const inv = applyOp(doc, { kind: 'update', id: r.id, patch: { x: 50, fill: '#222' } });
    expect(doc.get(r.id)).toMatchObject({ x: 50, y: 2, fill: '#222' });
    expect(inv).toEqual({ kind: 'update', id: r.id, patch: { x: 1, fill: '#111' } });
  });

  it('remove snapshots the whole subtree and its inverse restores order and links', () => {
    const doc = new SceneDocument();
    const a = doc.add('rect');
    const g = doc.add('group');
    const c1 = doc.add('rect', {}, g.id);
    const f = doc.add('frame', {}, g.id);
    const c2 = doc.add('ellipse', {}, f.id);
    const b = doc.add('rect');
    const before = dump(doc);
    const inv = applyOp(doc, { kind: 'remove', id: g.id });
    expect(doc.has(c2.id)).toBe(false);
    expect(doc.root.children).toEqual([a.id, b.id]);
    applyOp(doc, inv);
    expect(dump(doc)).toBe(before);
    expect(doc.get(g.id).children).toEqual([c1.id, f.id]);
  });

  it('reparent inverse restores parent and sibling index', () => {
    const doc = new SceneDocument();
    const f = doc.add('frame');
    const x = doc.add('rect', {}, f.id);
    const y = doc.add('rect', {}, f.id);
    const g = doc.add('group');
    const before = dump(doc);
    const inv = applyOp(doc, { kind: 'reparent', id: x.id, parentId: g.id });
    expect(doc.get(f.id).children).toEqual([y.id]);
    applyOp(doc, inv);
    expect(dump(doc)).toBe(before);
  });

  it('batch inverts in reverse order', () => {
    const doc = new SceneDocument();
    const r = doc.add('rect', { x: 0 });
    const before = dump(doc);
    const inv = applyOp(doc, {
      kind: 'batch',
      ops: [
        { kind: 'update', id: r.id, patch: { x: 5 } },
        { kind: 'update', id: r.id, patch: { x: 9 } },
      ],
    });
    expect(doc.get(r.id).x).toBe(9);
    applyOp(doc, inv);
    expect(dump(doc)).toBe(before);
  });
});

describe('History', () => {
  it('undoes and redoes, and a new action clears redo', () => {
    const doc = new SceneDocument();
    const h = new History(doc);
    const r = doc.add('rect', { x: 0 });
    h.apply('Move', { kind: 'update', id: r.id, patch: { x: 10 } });
    h.apply('Move', { kind: 'update', id: r.id, patch: { x: 20 } });
    expect(h.undoLabel).toBe('Move');
    h.undo();
    expect(doc.get(r.id).x).toBe(10);
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(doc.get(r.id).x).toBe(20);
    h.undo();
    h.apply('Move', { kind: 'update', id: r.id, patch: { x: 7 } });
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(true);
    expect(doc.get(r.id).x).toBe(10);
    expect(h.undo()).toBe(true);
    expect(doc.get(r.id).x).toBe(0);
    expect(h.undo()).toBe(false);
  });

  it('coalesces entries with the same key but not across an undo', () => {
    const doc = new SceneDocument();
    const h = new History(doc);
    const r = doc.add('rect', { x: 0 });
    for (const x of [1, 2, 3])
      h.apply('Nudge', { kind: 'update', id: r.id, patch: { x } }, 'nudge');
    h.undo();
    expect(doc.get(r.id).x).toBe(0);
    h.redo();
    expect(doc.get(r.id).x).toBe(3);
    h.undo();
    h.apply('Nudge', { kind: 'update', id: r.id, patch: { x: 8 } }, 'nudge');
    h.undo();
    expect(doc.get(r.id).x).toBe(0);
  });

  it('enforces the stack limit', () => {
    const doc = new SceneDocument();
    const h = new History(doc, 3);
    const r = doc.add('rect', { x: 0 });
    for (let i = 1; i <= 5; i++) h.apply('m', { kind: 'update', id: r.id, patch: { x: i } });
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
    expect(doc.get(r.id).x).toBe(2);
  });

  it('property: random ops then undo-all restores the original; redo-all restores the end', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rand = rng(seed);
      const doc = new SceneDocument();
      const h = new History(doc);
      // Some pre-existing, un-tracked content.
      const f0 = doc.add('frame');
      doc.add('rect', {}, f0.id);
      doc.add('group');
      const original = dump(doc);
      const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
      const types = ['rect', 'ellipse', 'line', 'frame', 'group'] as const;
      let steps = 0;
      for (let i = 0; i < 300; i++) {
        const ids = [...doc.paintOrder()].map((n) => n.id);
        const containers = [
          'root',
          ...[...doc.paintOrder()]
            .filter((n) => n.type === 'frame' || n.type === 'group')
            .map((n) => n.id),
        ];
        const roll = rand();
        let op: Op;
        if (roll < 0.35 || ids.length === 0) {
          // Build the add op from a throwaway doc so the node shape is realistic.
          const scratch = new SceneDocument();
          const made = scratch.add(pick([...types]), {
            id: `t${seed}_${i}`,
            x: Math.round(rand() * 500),
          });
          const rest = { ...made, children: undefined };
          const parentId = pick(containers);
          const index = Math.floor(rand() * (doc.get(parentId).children.length + 1));
          op = { kind: 'add', nodes: [{ ...rest, parentId, index } as never] };
        } else if (roll < 0.65) {
          op = {
            kind: 'update',
            id: pick(ids),
            patch: { x: rand() * 100, rotation: rand(), fill: rand() < 0.5 ? null : '#abc' },
          };
        } else if (roll < 0.8) {
          op = { kind: 'remove', id: pick(ids) };
        } else {
          const id = pick(ids);
          const target = pick(containers.filter((c) => !doc.isAncestorOrSelf(id, c)));
          op = { kind: 'reparent', id, parentId: target, index: Math.floor(rand() * 3) };
        }
        h.apply('op', op);
        steps++;
        // Occasionally exercise undo/redo mid-stream.
        if (rand() < 0.1 && h.undo()) h.redo();
      }
      const final = dump(doc);
      expect(steps).toBe(300);
      while (h.undo());
      expect(dump(doc)).toBe(original);
      while (h.redo());
      expect(dump(doc)).toBe(final);
    }
  });
});

describe('tools record history', () => {
  function setup() {
    const doc = new SceneDocument();
    const index = new SceneIndex(doc);
    const history = new History(doc);
    const camera = new Camera();
    const select = new SelectTool(doc, index, camera, undefined, history);
    const create = new CreateTool(doc, index, camera, undefined, undefined, history);
    return { doc, index, history, select, create };
  }

  it('a drag move is one undo step', () => {
    const { doc, index, history, select } = setup();
    const r = doc.add('rect', { x: 10, y: 10, width: 50, height: 50 });
    index.rebuild();
    select.pointerDown({ x: 30, y: 30 }, { shift: false });
    for (let i = 1; i <= 10; i++)
      select.pointerMove({ x: 30 + i * 5, y: 30 + i }, { shift: false });
    select.pointerUp();
    expect(doc.get(r.id)).toMatchObject({ x: 60, y: 20 });
    history.undo();
    expect(doc.get(r.id)).toMatchObject({ x: 10, y: 10 });
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(doc.get(r.id)).toMatchObject({ x: 60, y: 20 });
  });

  it('clicks, marquees and cancelled drags record nothing', () => {
    const { doc, index, history, select } = setup();
    doc.add('rect', { x: 10, y: 10, width: 50, height: 50 });
    index.rebuild();
    select.pointerDown({ x: 30, y: 30 }, { shift: false });
    select.pointerUp();
    select.pointerDown({ x: 30, y: 30 }, { shift: false });
    select.pointerMove({ x: 80, y: 80 }, { shift: false });
    select.cancel();
    select.pointerDown({ x: 300, y: 300 }, { shift: false });
    select.pointerMove({ x: 400, y: 400 }, { shift: false });
    select.pointerUp();
    expect(history.canUndo).toBe(false);
  });

  it('multi-node moves undo together', () => {
    const { doc, index, history, select } = setup();
    const a = doc.add('rect', { x: 0, y: 0, width: 20, height: 20 });
    const b = doc.add('rect', { x: 100, y: 0, width: 20, height: 20 });
    index.rebuild();
    select.selection.replace([a.id, b.id]);
    select.pointerDown({ x: 10, y: 10 }, { shift: false });
    select.pointerMove({ x: 40, y: 50 }, { shift: false });
    select.pointerUp();
    expect(doc.get(b.id).x).toBe(130);
    history.undo();
    expect(doc.get(a.id)).toMatchObject({ x: 0, y: 0 });
    expect(doc.get(b.id)).toMatchObject({ x: 100, y: 0 });
  });

  it('creation is undoable and redo restores the same shape', () => {
    const { doc, index, history, create } = setup();
    create.kind = 'ellipse';
    create.pointerDown({ x: 10, y: 10 });
    create.pointerMove({ x: 90, y: 60 }, { shift: false });
    const id = create.pointerUp({ x: 90, y: 60 }) as string;
    const snap = snapshotSubtree(doc, id);
    history.undo();
    index.rebuild();
    expect(doc.has(id)).toBe(false);
    history.redo();
    expect(doc.get(id)).toMatchObject({ type: 'ellipse', x: 10, y: 10, width: 80, height: 50 });
    expect(snapshotSubtree(doc, id)).toEqual(snap);
  });

  it('a discarded click-create leaves no history', () => {
    const { history, create } = setup();
    create.pointerDown({ x: 10, y: 10 });
    create.pointerUp({ x: 10, y: 10 });
    expect(history.canUndo).toBe(false);
  });
});
