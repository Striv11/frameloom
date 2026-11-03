import { beforeEach, describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { applyField, inspect, parseField } from '../src/tools/inspector';

let doc: SceneDocument;
let history: History;
beforeEach(() => {
  doc = new SceneDocument();
  history = new History(doc);
});
const field = (ids: string[], key: string) => inspect(doc, ids).find((f) => f.key === key)!;

describe('inspect', () => {
  it('reports values for one node, in display units', () => {
    const r = doc.add('rect', { x: 10.123, rotation: Math.PI / 2, opacity: 0.5 });
    expect(field([r.id], 'x').value).toEqual({ mixed: false, value: 10.12 });
    expect(field([r.id], 'rotation').value).toEqual({ mixed: false, value: 90 });
    expect(field([r.id], 'opacity').value).toEqual({ mixed: false, value: 50 });
  });
  it('flags mixed values and ignores non-editable nodes', () => {
    const a = doc.add('rect', { fill: '#ff0000', width: 10 });
    const b = doc.add('rect', { fill: '#00ff00', width: 10 });
    const l = doc.add('line', { width: 99 });
    expect(field([a.id, b.id], 'fill').value).toEqual({ mixed: true });
    expect(field([a.id, b.id, l.id], 'width').value).toEqual({ mixed: false, value: 10 });
    expect(field([l.id], 'width').editable).toBe(false);
    expect(inspect(doc, [])).toEqual([]);
  });
});

describe('parseField', () => {
  it('validates input', () => {
    expect(parseField('x', 'abc')).toBeUndefined();
    expect(parseField('x', '')).toBeUndefined();
    expect(parseField('opacity', 250)).toBe(1);
    expect(parseField('width', -5)).toBe(0);
    expect(parseField('fill', 'none')).toBeNull();
    expect(parseField('fill', '#abc')).toBe('#abc');
    expect(parseField('fill', 'red; drop')).toBeUndefined();
  });
});

describe('applyField', () => {
  it('edits all supporting nodes as one undo step', () => {
    const a = doc.add('rect', { x: 1 });
    const b = doc.add('ellipse', { x: 2 });
    expect(applyField(doc, history, [a.id, b.id], 'x', 40)).toBe(true);
    expect([doc.get(a.id).x, doc.get(b.id).x]).toEqual([40, 40]);
    history.undo();
    expect([doc.get(a.id).x, doc.get(b.id).x]).toEqual([1, 2]);
    history.redo();
    expect(doc.get(b.id).x).toBe(40);
  });
  it('skips unsupported nodes, invalid input and no-ops', () => {
    const l = doc.add('line', { width: 5 });
    expect(applyField(doc, history, [l.id], 'width', 50)).toBe(false);
    expect(applyField(doc, history, [l.id], 'x', 'nope')).toBe(false);
    expect(applyField(doc, history, [l.id], 'x', doc.get(l.id).x)).toBe(false);
    expect(history.canUndo).toBe(false);
  });
  it('coalesces repeated edits of a field into one step until sealed', () => {
    const r = doc.add('rect', { opacity: 1 });
    for (const v of [90, 70, 40]) applyField(doc, history, [r.id], 'opacity', v);
    expect(doc.get(r.id).opacity).toBeCloseTo(0.4);
    history.undo();
    expect(doc.get(r.id).opacity).toBe(1);
    expect(history.canUndo).toBe(false);
  });
  it('can clear a paint', () => {
    const r = doc.add('rect', { fill: '#fff' });
    applyField(doc, history, [r.id], 'fill', '');
    expect(doc.get(r.id).fill).toBeNull();
    history.undo();
    expect(doc.get(r.id).fill).toBe('#fff');
  });
});
