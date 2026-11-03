import { beforeEach, describe, expect, it } from 'vitest';
import { ROOT_ID, SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import {
  layerRows,
  moveLayer,
  renameLayer,
  setLayerLocked,
  setLayerVisible,
} from '../src/tools/layers';

let doc: SceneDocument;
let history: History;
beforeEach(() => {
  doc = new SceneDocument();
  history = new History(doc);
});
const order = (parent = ROOT_ID) => doc.get(parent).children.map((c) => doc.get(c).name);

describe('layerRows', () => {
  it('lists topmost first with children under their parent', () => {
    const a = doc.add('rect', { name: 'a' });
    const f = doc.add('frame', { name: 'f' });
    doc.add('rect', { name: 'c1' }, f.id);
    doc.add('rect', { name: 'c2' }, f.id);
    const rows = layerRows(doc);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ['f', 0],
      ['c2', 1],
      ['c1', 1],
      ['a', 0],
    ]);
    expect(rows[0]).toMatchObject({ expandable: true, collapsed: false });
    expect(layerRows(doc, new Set([f.id])).map((r) => r.name)).toEqual(['f', 'a']);
    expect(a.id).toBeTruthy();
  });
  it('caps the number of rows', () => {
    for (let i = 0; i < 10; i++) doc.add('rect');
    expect(layerRows(doc, new Set(), 4)).toHaveLength(4);
  });
  it('falls back to the type for unnamed nodes', () => {
    const e = doc.add('ellipse');
    doc.update(e.id, { name: '' });
    expect(layerRows(doc)[0]?.name).toBe('ellipse');
  });
});

describe('rename / visibility / lock', () => {
  it('are undoable single steps and ignore no-ops', () => {
    const r = doc.add('rect', { name: 'a' });
    expect(renameLayer(doc, history, r.id, '  Hero ')).toBe(true);
    expect(doc.get(r.id).name).toBe('Hero');
    expect(renameLayer(doc, history, r.id, 'Hero')).toBe(false);
    expect(renameLayer(doc, history, r.id, '   ')).toBe(false);
    expect(setLayerVisible(doc, history, r.id, false)).toBe(true);
    expect(setLayerVisible(doc, history, r.id, false)).toBe(false);
    expect(setLayerLocked(doc, history, r.id, true)).toBe(true);
    history.undo();
    history.undo();
    history.undo();
    expect(doc.get(r.id)).toMatchObject({ name: 'a', visible: true, locked: false });
    expect(history.canUndo).toBe(false);
  });
  it('refuses the root', () => {
    expect(renameLayer(doc, history, ROOT_ID, 'x')).toBe(false);
    expect(setLayerVisible(doc, history, ROOT_ID, false)).toBe(false);
  });
});

describe('moveLayer', () => {
  beforeEach(() => {
    doc.add('rect', { name: 'a' });
    doc.add('rect', { name: 'b' });
    doc.add('rect', { name: 'c' });
  });
  const id = (name: string) => doc.get(ROOT_ID).children.find((c) => doc.get(c).name === name)!;

  it('reorders above and below within a parent, in both directions', () => {
    expect(moveLayer(doc, history, id('a'), id('c'), 'above')).toBe(true);
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(moveLayer(doc, history, id('a'), id('b'), 'below')).toBe(true);
    expect(order()).toEqual(['a', 'b', 'c']);
    expect(moveLayer(doc, history, id('c'), id('a'), 'below')).toBe(true);
    expect(order()).toEqual(['c', 'a', 'b']);
    history.undo();
    history.undo();
    history.undo();
    expect(order()).toEqual(['a', 'b', 'c']);
  });
  it('treats dropping where it already is as a no-op', () => {
    expect(moveLayer(doc, history, id('b'), id('a'), 'above')).toBe(false);
    expect(moveLayer(doc, history, id('b'), id('c'), 'below')).toBe(false);
    expect(history.canUndo).toBe(false);
  });
  it('moves into a frame keeping world position', () => {
    const f = doc.add('frame', { name: 'f', x: 100, y: 50 });
    const b = id('b');
    doc.update(b, { x: 130, y: 70 });
    expect(moveLayer(doc, history, b, f.id, 'inside')).toBe(true);
    expect(doc.get(b)).toMatchObject({ parentId: f.id, x: 30, y: 20 });
    expect(doc.worldBounds(b)).toMatchObject({ x: 130, y: 70 });
    history.undo();
    expect(doc.get(b)).toMatchObject({ parentId: ROOT_ID, x: 130, y: 70 });
    history.redo();
    expect(doc.get(b).parentId).toBe(f.id);
  });
  it('moves out of a frame keeping world position', () => {
    const f = doc.add('frame', { name: 'f', x: 100, y: 50 });
    const k = doc.add('rect', { name: 'k', x: 5, y: 6 }, f.id);
    expect(moveLayer(doc, history, k.id, id('a'), 'below')).toBe(true);
    expect(doc.get(k.id)).toMatchObject({ parentId: ROOT_ID, x: 105, y: 56 });
  });
  it('rejects cycles, non-containers, the root and rotated parents', () => {
    const f = doc.add('frame', { name: 'f' });
    const g = doc.add('frame', { name: 'g' }, f.id);
    expect(moveLayer(doc, history, f.id, g.id, 'inside')).toBe(false);
    expect(moveLayer(doc, history, f.id, g.id, 'above')).toBe(false);
    expect(moveLayer(doc, history, id('a'), id('b'), 'inside')).toBe(false);
    expect(moveLayer(doc, history, ROOT_ID, id('a'), 'above')).toBe(false);
    expect(moveLayer(doc, history, id('a'), ROOT_ID, 'below')).toBe(false);
    doc.update(f.id, { rotation: 0.5 });
    expect(moveLayer(doc, history, id('a'), f.id, 'inside')).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});
