import { beforeEach, describe, expect, it } from 'vitest';
import { ROOT_ID, SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { groupNodes, keepWorldPatch, placementIn, ungroupNodes } from '../src/tools/grouping';

let doc: SceneDocument;
let history: History;
beforeEach(() => {
  doc = new SceneDocument();
  history = new History(doc);
});

const expectSameWorld = (id: string, before: readonly number[]) => {
  doc.worldMatrix(id).forEach((v, i) => expect(v).toBeCloseTo(before[i] as number, 9));
};
const names = (parent: string = ROOT_ID) => doc.get(parent).children.map((c) => doc.get(c).name);

describe('placementIn', () => {
  it('compensates both translation and rotation of the new parent', () => {
    const f = doc.add('frame', { x: 50, y: 20, rotation: 0.7 });
    const r = doc.add('rect', { x: 200, y: 100, rotation: 0.2 });
    const before = doc.worldMatrix(r.id);
    const p = placementIn(doc, r.id, f.id);
    expect(p.rotation).toBeCloseTo(-0.5, 9);
    doc.reparent(r.id, f.id);
    doc.update(r.id, p);
    expectSameWorld(r.id, before);
  });
  it('returns no patch when nothing changes', () => {
    const r = doc.add('rect', { x: 3, y: 4 });
    expect(keepWorldPatch(doc, r.id, ROOT_ID)).toBeNull();
  });
});

describe('groupNodes', () => {
  it('wraps members at the topmost member position, preserving order and world', () => {
    const a = doc.add('rect', { name: 'a', x: 10, y: 10, width: 20, height: 20 });
    doc.add('rect', { name: 'mid', x: 0, y: 0 });
    const c = doc.add('rect', { name: 'c', x: 100, y: 50, width: 30, height: 10 });
    const before = [a, c].map((n) => doc.worldMatrix(n.id));
    const gid = groupNodes(doc, history, [c.id, a.id])!;
    expect(names()).toEqual(['mid', 'Group']);
    expect(names(gid)).toEqual(['a', 'c']);
    expect(doc.get(gid)).toMatchObject({ x: 10, y: 10, width: 120, height: 50 });
    expectSameWorld(a.id, before[0]!);
    expectSameWorld(c.id, before[1]!);
  });
  it('is one undo step and redo restores it', () => {
    const a = doc.add('rect', { name: 'a', x: 5 });
    const b = doc.add('rect', { name: 'b', x: 70 });
    const snapshot = JSON.stringify([...doc.paintOrder()]);
    groupNodes(doc, history, [a.id, b.id]);
    const grouped = JSON.stringify([...doc.paintOrder()]);
    expect(history.undo()).toBe(true);
    expect(JSON.stringify([...doc.paintOrder()])).toBe(snapshot);
    expect(history.canUndo).toBe(false);
    history.redo();
    expect(JSON.stringify([...doc.paintOrder()])).toBe(grouped);
  });
  it('keeps world transforms inside a rotated frame', () => {
    const f = doc.add('frame', { x: 100, y: 100, rotation: 0.4 });
    const a = doc.add('rect', { x: 10, y: 10, rotation: 0.3 }, f.id);
    const b = doc.add('ellipse', { x: 80, y: 30 }, f.id);
    const before = [a, b].map((n) => doc.worldMatrix(n.id));
    const gid = groupNodes(doc, history, [a.id, b.id])!;
    expect(doc.get(gid).parentId).toBe(f.id);
    expectSameWorld(a.id, before[0]!);
    expectSameWorld(b.id, before[1]!);
  });
  it('ignores descendants of other members and empty input', () => {
    const g = doc.add('group', { name: 'g' });
    const k = doc.add('rect', {}, g.id);
    expect(groupNodes(doc, history, [])).toBeNull();
    expect(groupNodes(doc, history, [ROOT_ID])).toBeNull();
    const gid = groupNodes(doc, history, [g.id, k.id])!;
    expect(doc.get(g.id).parentId).toBe(gid);
    expect(doc.get(k.id).parentId).toBe(g.id);
  });
});

describe('ungroupNodes', () => {
  it('frees children in place with unchanged world transforms', () => {
    const below = doc.add('rect', { name: 'below' });
    const g = doc.add('group', { name: 'g', x: 40, y: 30, rotation: 0.6 });
    const a = doc.add('rect', { name: 'a', x: 5, y: 6 }, g.id);
    const b = doc.add('rect', { name: 'b', x: 50, y: 6, rotation: 0.1 }, g.id);
    doc.add('rect', { name: 'above' });
    const before = [a, b].map((n) => doc.worldMatrix(n.id));
    expect(ungroupNodes(doc, history, [g.id])).toEqual([a.id, b.id]);
    expect(names()).toEqual(['below', 'a', 'b', 'above']);
    expectSameWorld(a.id, before[0]!);
    expectSameWorld(b.id, before[1]!);
    expect(doc.has(g.id)).toBe(false);
    history.undo();
    expect(names()).toEqual(['below', 'g', 'above']);
    expect(names(g.id)).toEqual(['a', 'b']);
    expect(doc.get(a.id)).toMatchObject({ x: 5, y: 6, rotation: 0 });
    expect(below.id).toBeTruthy();
  });
  it('handles several groups, skips frames and non-groups', () => {
    const g1 = doc.add('group', { name: 'g1', x: 10 });
    doc.add('rect', { name: 'a' }, g1.id);
    const g2 = doc.add('group', { name: 'g2', x: 200 });
    doc.add('rect', { name: 'b' }, g2.id);
    doc.add('rect', { name: 'c' }, g2.id);
    const f = doc.add('frame', { name: 'f' });
    const r = doc.add('rect', { name: 'r' });
    ungroupNodes(doc, history, [g1.id, g2.id, f.id, r.id]);
    expect(names()).toEqual(['a', 'b', 'c', 'f', 'r']);
    expect(ungroupNodes(doc, history, [f.id, r.id])).toEqual([]);
    history.undo();
    expect(names()).toEqual(['g1', 'g2', 'f', 'r']);
  });
  it('ungrouping an outer group leaves a selected inner group intact', () => {
    const outer = doc.add('group', { name: 'outer' });
    const inner = doc.add('group', { name: 'inner' }, outer.id);
    doc.add('rect', { name: 'leaf' }, inner.id);
    ungroupNodes(doc, history, [outer.id, inner.id]);
    expect(names()).toEqual(['inner']);
    expect(names(inner.id)).toEqual(['leaf']);
  });
});
