import { describe, expect, it } from 'vitest';
import { ROOT_ID, SceneDocument } from '../src/model/document';
import { createDemoDocument, createStressDocument } from '../src/app/demo';

describe('SceneDocument', () => {
  it('starts with only a root', () => {
    const doc = new SceneDocument();
    expect(doc.size).toBe(0);
    expect(doc.root.id).toBe(ROOT_ID);
  });

  it('adds nodes with defaults and unique ids', () => {
    const doc = new SceneDocument();
    const a = doc.add('rect');
    const b = doc.add('ellipse', { width: 5 });
    expect(a.id).not.toBe(b.id);
    expect(b.width).toBe(5);
    expect(doc.root.children).toEqual([a.id, b.id]);
    expect(a.parentId).toBe(ROOT_ID);
  });

  it('rejects duplicate ids and non-container parents', () => {
    const doc = new SceneDocument();
    const r = doc.add('rect', { id: 'x' });
    expect(() => doc.add('rect', { id: 'x' })).toThrow(/Duplicate/);
    expect(() => doc.add('rect', {}, r.id)).toThrow(/cannot have children/);
  });

  it('does not reuse a generated id that was taken explicitly', () => {
    const doc = new SceneDocument();
    doc.add('rect', { id: 'n1' });
    expect(doc.add('rect').id).not.toBe('n1');
  });

  it('inserts at an index', () => {
    const doc = new SceneDocument();
    const a = doc.add('rect');
    const b = doc.add('rect');
    const c = doc.add('rect', {}, ROOT_ID, 1);
    expect(doc.root.children).toEqual([a.id, c.id, b.id]);
  });

  it('removes whole subtrees', () => {
    const doc = new SceneDocument();
    const g = doc.add('group');
    const child = doc.add('rect', {}, g.id);
    const keep = doc.add('rect');
    expect(doc.remove(g.id).sort()).toEqual([g.id, child.id].sort());
    expect(doc.has(child.id)).toBe(false);
    expect(doc.root.children).toEqual([keep.id]);
  });

  it('refuses to remove or modify the root', () => {
    const doc = new SceneDocument();
    expect(() => doc.remove(ROOT_ID)).toThrow();
    expect(() => doc.update(ROOT_ID, { x: 1 })).toThrow();
  });

  it('reparents and prevents cycles', () => {
    const doc = new SceneDocument();
    const f = doc.add('frame');
    const g = doc.add('group', {}, f.id);
    const r = doc.add('rect');
    doc.reparent(r.id, g.id);
    expect(doc.get(r.id).parentId).toBe(g.id);
    expect(doc.root.children).toEqual([f.id]);
    expect(() => doc.reparent(f.id, g.id)).toThrow(/into itself/);
    expect(() => doc.reparent(f.id, f.id)).toThrow(/into itself/);
  });

  it('composes world matrices through nested rotated parents', () => {
    const doc = new SceneDocument();
    const f = doc.add('frame', { x: 100, y: 50, rotation: Math.PI / 2 });
    const r = doc.add('rect', { x: 10, y: 0, width: 4, height: 4 }, f.id);
    const b = doc.worldBounds(r.id);
    // Local (10,0) rotated 90deg cw => (0,10), then offset by (100,50).
    expect(b.x).toBeCloseTo(96);
    expect(b.y).toBeCloseTo(60);
    expect(b.width).toBeCloseTo(4);
  });

  it('computes subtree bounds including children outside the parent', () => {
    const doc = new SceneDocument();
    const g = doc.add('group', { x: 0, y: 0, width: 10, height: 10 });
    doc.add('rect', { x: 90, y: 90, width: 10, height: 10 }, g.id);
    expect(doc.subtreeBounds(g.id)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(new SceneDocument().subtreeBounds(ROOT_ID)).toBeNull();
  });

  it('yields paint order parents-first, bottom-to-top', () => {
    const doc = new SceneDocument();
    const a = doc.add('frame');
    const a1 = doc.add('rect', {}, a.id);
    const a2 = doc.add('rect', {}, a.id);
    const b = doc.add('rect');
    expect([...doc.paintOrder()].map((n) => n.id)).toEqual([a.id, a1.id, a2.id, b.id]);
  });

  it('updates fields', () => {
    const doc = new SceneDocument();
    const r = doc.add('rect');
    doc.update(r.id, { x: 5, fill: '#000' });
    expect(doc.get(r.id)).toMatchObject({ x: 5, fill: '#000' });
  });
});

describe('demo documents', () => {
  it('demo document is a consistent tree', () => {
    const doc = createDemoDocument();
    expect(doc.size).toBeGreaterThan(10);
    for (const n of doc.paintOrder()) {
      expect(doc.get(n.parentId as string).children).toContain(n.id);
    }
  });

  it('stress document is deterministic and sized', () => {
    const a = createStressDocument(1000, 7);
    const b = createStressDocument(1000, 7);
    expect(a.size).toBe(1000);
    expect(a.get('n10')).toEqual(b.get('n10'));
  });
});
