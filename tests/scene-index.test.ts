import { describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { SceneIndex } from '../src/spatial/scene-index';
import { createStressDocument } from '../src/app/demo';

describe('SceneIndex', () => {
  it('returns the topmost node under the point', () => {
    const doc = new SceneDocument();
    const a = doc.add('rect', { x: 0, y: 0, width: 100, height: 100 });
    const b = doc.add('rect', { x: 50, y: 50, width: 100, height: 100 });
    const idx = new SceneIndex(doc);
    expect(idx.hitTest({ x: 10, y: 10 })).toBe(a.id);
    expect(idx.hitTest({ x: 75, y: 75 })).toBe(b.id);
    expect(idx.hitTest({ x: 500, y: 500 })).toBeNull();
  });

  it('respects rotation: AABB hit but outside the real box misses', () => {
    const doc = new SceneDocument();
    const r = doc.add('rect', { x: 0, y: 0, width: 100, height: 10, rotation: Math.PI / 4 });
    const idx = new SceneIndex(doc);
    // Along the diagonal: inside. Near the AABB's bottom-left: outside.
    expect(idx.hitTest({ x: 35, y: 35 })).toBe(r.id);
    expect(idx.hitTest({ x: 5, y: 60 })).toBeNull();
  });

  it('uses the ellipse shape, not its corners', () => {
    const doc = new SceneDocument();
    const e = doc.add('ellipse', { x: 0, y: 0, width: 100, height: 100 });
    const idx = new SceneIndex(doc);
    expect(idx.hitTest({ x: 50, y: 50 })).toBe(e.id);
    expect(idx.hitTest({ x: 3, y: 3 })).toBeNull();
  });

  it('skips hidden and locked nodes, including via ancestors', () => {
    const doc = new SceneDocument();
    const g = doc.add('group', { x: 0, y: 0, width: 100, height: 100 });
    doc.add('rect', { x: 0, y: 0, width: 100, height: 100 }, g.id);
    const under = doc.add('rect', { x: 0, y: 0, width: 100, height: 100 });
    // Re-order so `under` is actually below the group.
    doc.reparent(under.id, doc.root.id, 0);
    const idx = new SceneIndex(doc);
    doc.update(g.id, { locked: true });
    expect(idx.hitTest({ x: 5, y: 5 })).toBe(under.id);
    doc.update(under.id, { visible: false });
    expect(idx.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('follows moves after refresh and works with nested parents', () => {
    const doc = new SceneDocument();
    const f = doc.add('frame', { x: 100, y: 100, width: 200, height: 200 });
    const c = doc.add('rect', { x: 10, y: 10, width: 20, height: 20 }, f.id);
    const idx = new SceneIndex(doc);
    expect(idx.hitTest({ x: 115, y: 115 })).toBe(c.id);
    doc.update(f.id, { x: 500 });
    idx.refresh(f.id);
    expect(idx.hitTest({ x: 115, y: 115 })).toBeNull();
    expect(idx.hitTest({ x: 515, y: 115 })).toBe(c.id);
    expect(idx.query({ x: 515, y: 115, width: 1, height: 1 })).toEqual([f.id, c.id]);
  });

  it('indexes a 10k stress document', () => {
    const doc = createStressDocument(10_000);
    const idx = new SceneIndex(doc);
    expect(idx.tree.size).toBe(10_000);
    idx.tree.validate();
  });
});
