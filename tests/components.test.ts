import { describe, expect, it } from 'vitest';
import {
  createInstance,
  detachInstance,
  findMaster,
  makeComponent,
  resetOverrides,
  syncInstances,
} from '../src/model/components';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { applyField } from '../src/tools/inspector';

/** History that re-derives instances after every change, like the app does. */
function setup() {
  const doc = new SceneDocument();
  const history = new History(doc, 500, () => {
    syncInstances(doc);
  });
  const master = doc.add('frame', { name: 'Button', x: 0, y: 0, width: 120, height: 40 });
  const bg = doc.add('rect', { name: 'bg', width: 120, height: 40, fill: '#336699' }, master.id);
  const label = doc.add('text', { name: 'label', text: 'Click', x: 8, y: 8 }, master.id);
  return { doc, history, master, bg, label };
}

const kids = (doc: SceneDocument, id: string) => doc.get(id).children.map((c) => doc.get(c));

describe('components', () => {
  it('makes a component only from plain frames', () => {
    const { doc, history, master, bg } = setup();
    expect(makeComponent(doc, history, bg.id)).toBe(false);
    expect(makeComponent(doc, history, master.id)).toBe(true);
    expect(makeComponent(doc, history, master.id)).toBe(false);
    expect(doc.get(master.id).component).toBe(true);
  });

  it('instantiates a mirror of the master and propagates master edits', () => {
    const { doc, history, master, bg, label } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    const [ibg, ilabel] = kids(doc, inst);
    expect(ibg).toMatchObject({ sourceId: bg.id, fill: '#336699', width: 120 });
    expect(ilabel).toMatchObject({ sourceId: label.id, text: 'Click', x: 8 });

    history.apply('recolor', { kind: 'update', id: bg.id, patch: { fill: '#ff0000' } });
    history.apply('resize', { kind: 'update', id: master.id, patch: { width: 200 } });
    expect(doc.get(ibg!.id).fill).toBe('#ff0000');
    expect(doc.get(inst).width).toBe(200);
  });

  it('keeps per-instance overrides when the master changes', () => {
    const { doc, history, master, bg, label } = setup();
    makeComponent(doc, history, master.id);
    const a = createInstance(doc, history, master.id)!;
    const b = createInstance(doc, history, master.id)!;
    const ibg = kids(doc, a)[0]!;
    expect(applyField(doc, history, [ibg.id], 'fill', '#00ff00')).toBe(true);
    expect(doc.get(ibg.id).overrides).toEqual({ fill: '#00ff00' });

    history.apply('recolor', { kind: 'update', id: bg.id, patch: { fill: '#111111' } });
    expect(doc.get(ibg.id).fill).toBe('#00ff00'); // overridden
    expect(doc.get(kids(doc, b)[0]!.id).fill).toBe('#111111'); // inherited
    history.apply('retext', { kind: 'update', id: label.id, patch: { text: 'Go' } });
    expect((kids(doc, a)[1] as { text: string }).text).toBe('Go');
  });

  it('overrides text per instance and resets it', () => {
    const { doc, history, master, label } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    const t = kids(doc, inst)[1]!;
    history.apply('text', {
      kind: 'update',
      id: t.id,
      patch: { text: 'Buy', overrides: { text: 'Buy' } },
    });
    history.apply('retext', { kind: 'update', id: label.id, patch: { text: 'Go' } });
    expect((doc.get(t.id) as { text: string }).text).toBe('Buy');
    expect(resetOverrides(doc, history, inst)).toBe(true);
    expect(doc.get(t.id)).toMatchObject({ text: 'Go', overrides: {} });
    expect(resetOverrides(doc, history, inst)).toBe(false);
  });

  it('follows structural changes in the master', () => {
    const { doc, history, master } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    const extra = doc.add('ellipse', { name: 'dot' }, master.id);
    history.record('add', { kind: 'remove', id: extra.id }, { kind: 'remove', id: extra.id });
    syncInstances(doc);
    expect(kids(doc, inst).map((n) => n.sourceId)).toEqual(doc.get(master.id).children);
    history.apply('remove', { kind: 'remove', id: extra.id });
    expect(kids(doc, inst)).toHaveLength(2);
  });

  it('undo and redo re-derive instances without extra history entries', () => {
    const { doc, history, master, bg } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    const ibg = kids(doc, inst)[0]!.id;
    history.apply('recolor', { kind: 'update', id: bg.id, patch: { fill: '#ff0000' } });
    expect(doc.get(ibg).fill).toBe('#ff0000');
    history.undo();
    expect(doc.get(ibg).fill).toBe('#336699');
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(doc.get(ibg).fill).toBe('#ff0000');
    // undo the instance creation and the component itself
    history.undo();
    history.undo();
    expect(doc.has(inst)).toBe(false);
    history.undo();
    expect(doc.get(master.id).component).toBeUndefined();
  });

  it('undoes an override together with its value', () => {
    const { doc, history, master } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    const ibg = kids(doc, inst)[0]!.id;
    applyField(doc, history, [ibg], 'fill', '#00ff00');
    history.undo();
    expect(doc.get(ibg).fill).toBe('#336699');
    expect(doc.get(ibg).overrides).toBeUndefined();
  });

  it('detaching freezes an instance; deleting the master detaches instances', () => {
    const { doc, history, master, bg } = setup();
    makeComponent(doc, history, master.id);
    const a = createInstance(doc, history, master.id)!;
    const b = createInstance(doc, history, master.id)!;
    expect(detachInstance(doc, history, kids(doc, a)[0]!.id)).toBe(true); // via a child
    history.apply('recolor', { kind: 'update', id: bg.id, patch: { fill: '#ff0000' } });
    expect(doc.get(kids(doc, a)[0]!.id).fill).toBe('#336699');
    expect(doc.get(a).instanceOf).toBeUndefined();
    expect(doc.get(kids(doc, b)[0]!.id).fill).toBe('#ff0000');

    history.apply('delete master', { kind: 'remove', id: master.id });
    expect(doc.get(b).instanceOf).toBeUndefined();
    expect(kids(doc, b)).toHaveLength(2); // content stays as ordinary nodes
    expect(kids(doc, b)[0]!.sourceId).toBeUndefined();
  });

  it('collapses duplicate derived children deterministically', () => {
    const { doc, history, master, bg } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    doc.add('rect', { sourceId: bg.id, id: 'zzz' } as never, inst);
    syncInstances(doc);
    expect(kids(doc, inst).filter((n) => n.sourceId === bg.id)).toHaveLength(1);
    expect(doc.has('zzz')).toBe(false);
  });
});

describe('findMaster', () => {
  it('resolves the master from an instance root or any part of it', () => {
    const { doc, history, master, bg } = setup();
    makeComponent(doc, history, master.id);
    const inst = createInstance(doc, history, master.id)!;
    const [part] = kids(doc, inst);
    expect(findMaster(doc, inst)).toBe(master.id);
    expect(findMaster(doc, part!.id)).toBe(master.id);
    expect(findMaster(doc, bg.id)).toBeNull();
    expect(findMaster(doc, master.id)).toBeNull();
  });

  it('returns null after detaching or when the master is deleted', () => {
    const { doc, history, master } = setup();
    makeComponent(doc, history, master.id);
    const a = createInstance(doc, history, master.id)!;
    const b = createInstance(doc, history, master.id)!;
    detachInstance(doc, history, a);
    expect(findMaster(doc, a)).toBeNull();
    doc.remove(master.id);
    expect(findMaster(doc, b)).toBeNull();
  });
});
