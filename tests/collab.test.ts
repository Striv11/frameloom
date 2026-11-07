import { describe, expect, it } from 'vitest';
import { CollabSession } from '../src/collab/session';
import { reconcile } from '../src/collab/reconcile';
import { MemoryStore } from '../src/collab/store';
import { MemoryHub } from '../src/collab/transport';
import { dumpDocument, Replica } from '../src/crdt/replica';
import { ROOT_ID, SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';

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

function peer(hub: MemoryHub, id: string, store?: MemoryStore) {
  const doc = new SceneDocument();
  doc.idPrefix = `${id}-`;
  const replica = new Replica(id);
  const session = new CollabSession({ doc, replica, transport: hub.join(), store });
  const history = new History(doc, 500, () => {
    session.localChanged();
  });
  return { doc, replica, session, history };
}

describe('reconcile', () => {
  it('turns one document into another, including reorder and reparent', () => {
    const a = new SceneDocument();
    const f = a.add('frame', { id: 'f' });
    a.add('rect', { id: 'r1', x: 1 }, f.id);
    a.add('rect', { id: 'r2' }, f.id);
    a.add('ellipse', { id: 'e' });

    const b = new SceneDocument();
    const g = b.add('group', { id: 'g' });
    b.add('rect', { id: 'r2', x: 5 }, g.id);
    b.add('rect', { id: 'r1' }, g.id);
    b.add('frame', { id: 'f' }); // f is now empty, r1/r2 moved under g
    b.add('text', { id: 't', text: 'hi' });

    const seen: string[] = [];
    reconcile(a, b, {
      add: (n) => seen.push(`add ${n.id}`),
      update: (id) => seen.push(`update ${id}`),
      move: (id) => seen.push(`move ${id}`),
      remove: (id) => seen.push(`remove ${id}`),
    });
    expect(dumpDocument(a)).toBe(dumpDocument(b));
    expect(a.root.children).toEqual(b.root.children);
    expect(seen).toContain('remove e');
    // already equal: no further edits
    const again: string[] = [];
    reconcile(a, b, {
      add: () => again.push('a'),
      update: () => again.push('u'),
      move: () => again.push('m'),
      remove: () => again.push('r'),
    });
    expect(again).toEqual([]);
  });

  it('survives a node moving under what used to be its child', () => {
    const a = new SceneDocument();
    a.add('group', { id: 'A' });
    a.add('group', { id: 'B' }, 'A');
    const b = new SceneDocument();
    b.add('group', { id: 'B' });
    b.add('group', { id: 'A' }, 'B');
    reconcile(a, b);
    expect(dumpDocument(a)).toBe(dumpDocument(b));
  });
});

describe('collaboration session', () => {
  it('mirrors edits both ways between two peers', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a');
    const b = peer(hub, 'b');
    a.history.apply('add', {
      kind: 'add',
      nodes: [
        {
          id: 'a-1',
          type: 'rect',
          parentId: ROOT_ID,
          index: 0,
          name: 'R',
          x: 3,
          y: 4,
          width: 10,
          height: 10,
          rotation: 0,
          visible: true,
          locked: false,
          opacity: 1,
          fill: '#fff',
          stroke: null,
          strokeWidth: 1,
        },
      ],
    });
    expect(b.doc.find('a-1')?.x).toBe(3);

    b.history.apply('move', { kind: 'update', id: 'a-1', patch: { x: 99 } });
    expect(a.doc.get('a-1').x).toBe(99);

    // undo on the author's side removes it everywhere, redo brings it back
    a.history.undo();
    expect(b.doc.has('a-1')).toBe(false);
    a.history.redo();
    expect(b.doc.has('a-1')).toBe(true);
    expect(dumpDocument(a.doc)).toBe(dumpDocument(b.doc));
  });

  it('a late joiner receives a snapshot via hello', async () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a');
    const f = a.doc.add('frame', { id: 'a-f' });
    a.doc.add('rect', { id: 'a-r' }, f.id);
    a.session.localChanged();
    const c = peer(hub, 'c');
    await c.session.start();
    expect(dumpDocument(c.doc)).toBe(dumpDocument(a.doc));
  });

  it('persists to a store and restores into a fresh document', async () => {
    const store = new MemoryStore();
    const hub = new MemoryHub();
    const a = peer(hub, 'a', store);
    await a.session.start();
    a.doc.add('rect', { id: 'a-r', x: 7 });
    a.session.localChanged();
    a.doc.update('a-r', { x: 8 });
    a.session.localChanged();
    await a.session.flush();

    const reborn = peer(new MemoryHub(), 'z', store);
    await reborn.session.start();
    expect(reborn.doc.get('a-r').x).toBe(8);
    expect(reborn.doc.size).toBe(1);
  });

  it('seeds the store from the initial document when it is empty', async () => {
    const store = new MemoryStore();
    const a = peer(new MemoryHub(), 'a', store);
    a.doc.add('rect', { id: 'seed' });
    await a.session.start();
    await a.session.flush();
    const b = peer(new MemoryHub(), 'b', store);
    await b.session.start();
    expect(b.doc.has('seed')).toBe(true);
  });

  it('converges under random concurrent edits with reordered delivery', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed);
      const hub = new MemoryHub();
      const peers = ['a', 'b', 'c'].map((id) => peer(hub, id));
      const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
      hub.pause();
      for (let step = 0; step < 25; step++) {
        const p = pick(peers);
        const ids = [...p.doc.paintOrder()].map((n) => n.id);
        const r = rand();
        if (ids.length === 0 || r < 0.35) {
          const containers = [ROOT_ID, ...ids.filter((i) => p.doc.get(i).type === 'frame')];
          const parent = pick(containers);
          const id = `${p.replica.id}-${step}`;
          p.doc.add(rand() < 0.3 ? 'frame' : 'rect', { id, x: Math.round(rand() * 100) }, parent);
        } else if (r < 0.6) {
          p.doc.update(pick(ids), { x: Math.round(rand() * 500) });
        } else if (r < 0.8) {
          const id = pick(ids);
          const targets = [
            ROOT_ID,
            ...ids.filter((i) => p.doc.get(i).type === 'frame' && !p.doc.isAncestorOrSelf(id, i)),
          ];
          p.doc.reparent(id, pick(targets), Math.floor(rand() * 3));
        } else {
          p.doc.remove(pick(ids));
        }
        p.session.localChanged();
      }
      hub.flush(rand() < 0.5);
      // converge: every peer merges everyone's full state
      const all = peers.flatMap((p) => p.replica.snapshot());
      for (const p of peers) {
        for (const op of all) p.replica.apply(op);
        reconcile(p.doc, p.replica.toDocument());
      }
      const dumps = peers.map((p) => dumpDocument(p.doc));
      expect(dumps[1]).toBe(dumps[0]);
      expect(dumps[2]).toBe(dumps[0]);
      expect(dumps[0]).toBe(dumpDocument(peers[0]!.replica.toDocument()));
    }
  });

  it('tracks presence cursors and drops them on bye', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a');
    const b = peer(hub, 'b');
    a.session.sendCursor(10, 20, '#f00', 'Ann');
    expect(b.session.peers.get('a')).toMatchObject({ x: 10, y: 20, name: 'Ann' });
    a.session.close();
    expect(b.session.peers.size).toBe(0);
  });

  it('history snapshots of removed subtrees come back with children after undo', () => {
    const hub = new MemoryHub();
    const a = peer(hub, 'a');
    const b = peer(hub, 'b');
    const f = a.doc.add('frame', { id: 'a-f' });
    a.doc.add('rect', { id: 'a-r' }, f.id);
    a.session.localChanged();
    a.history.apply('delete', { kind: 'remove', id: 'a-f' });
    expect(b.doc.size).toBe(0);
    a.history.undo();
    expect(b.doc.has('a-r')).toBe(true);
    expect(b.doc.get('a-r').parentId).toBe('a-f');
  });
});
