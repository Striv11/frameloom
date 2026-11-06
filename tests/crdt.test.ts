import { describe, expect, it } from 'vitest';
import { between, betweenMany } from '../src/crdt/fractional';
import { dumpDocument, Replica, type Op } from '../src/crdt/replica';
import { ROOT_ID } from '../src/model/document';

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

describe('fractional index', () => {
  it('always yields a key strictly between neighbours', () => {
    const rand = rng(1);
    let keys: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(rand() * (keys.length + 1));
      const k = between(keys[at - 1] ?? null, keys[at] ?? null);
      if (at > 0) expect(k > (keys[at - 1] as string)).toBe(true);
      if (at < keys.length) expect(k < (keys[at] as string)).toBe(true);
      expect(k.endsWith('0')).toBe(false);
      keys = [...keys.slice(0, at), k, ...keys.slice(at)];
    }
    expect([...keys].sort()).toEqual(keys);
  });

  it('handles adjacent digits and repeated front/back insertion', () => {
    expect(between('1', '2') > '1' && between('1', '2') < '2').toBe(true);
    let lo: string | null = null;
    let first: string | null = null;
    for (let i = 0; i < 50; i++) {
      const k = between(null, first);
      if (first !== null) expect(k < first).toBe(true);
      first = k;
      lo = between(lo, null);
    }
    const many = betweenMany('a', 'b', 40);
    expect(new Set(many).size).toBe(40);
    expect([...many].sort()).toEqual(many);
    expect(() => between('b', 'a')).toThrow();
  });
});

describe('Replica', () => {
  it('materializes created nodes in order and supports insert at index', () => {
    const a = new Replica('a');
    const r1 = a.create('rect', { x: 1 });
    const r2 = a.create('rect', { x: 2 });
    const r0 = a.create('rect', { x: 0 }, ROOT_ID, 0);
    const doc = a.toDocument();
    expect(doc.root.children).toEqual([r0.id, r1.id, r2.id]);
    expect(doc.get(r2.id).x).toBe(2);
  });

  it('keeps concurrent edits to different properties and resolves the same one by stamp', () => {
    const a = new Replica('a');
    const b = new Replica('b');
    const { id, ops } = a.create('rect');
    b.applyAll(ops);
    const oa = a.set(id, { x: 10, fill: '#111' });
    const ob = b.set(id, { x: 20, stroke: '#222' });
    a.applyAll(ob);
    b.applyAll(oa);
    expect(dumpDocument(a.toDocument())).toBe(dumpDocument(b.toDocument()));
    const n = a.toDocument().get(id);
    expect(n.fill).toBe('#111');
    expect(n.stroke).toBe('#222');
    expect(n.x).toBe(20); // equal counters: replica 'b' > 'a'
  });

  it('is idempotent and accepts ops before the node exists', () => {
    const a = new Replica('a');
    const b = new Replica('b');
    const { id, ops } = a.create('rect', { x: 5 });
    const more = a.set(id, { y: 7 });
    b.applyAll([...more, ...more, ...ops.slice().reverse(), ...ops]);
    expect(b.apply(ops[0] as Op)).toBe(false);
    expect(dumpDocument(b.toDocument())).toBe(dumpDocument(a.toDocument()));
  });

  it('deletion hides the subtree, and restore with a newer stamp wins', () => {
    const a = new Replica('a');
    const f = a.create('frame');
    const c = a.create('rect', {}, f.id);
    a.remove(f.id);
    expect(a.toDocument().size).toBe(0);
    a.restore(f.id);
    expect(a.toDocument().get(c.id).parentId).toBe(f.id);
  });

  it('a child added concurrently to a deleted parent disappears with it', () => {
    const a = new Replica('a');
    const b = new Replica('b');
    const f = a.create('frame');
    b.applyAll(f.ops);
    const del = a.remove(f.id);
    const add = b.create('rect', {}, f.id);
    a.applyAll(add.ops);
    b.applyAll(del);
    expect(a.toDocument().size).toBe(0);
    expect(b.toDocument().size).toBe(0);
  });

  it('concurrent moves forming a cycle converge with the cycle broken', () => {
    const a = new Replica('a');
    const b = new Replica('b');
    const f1 = a.create('frame');
    const f2 = a.create('frame');
    b.applyAll([...f1.ops, ...f2.ops]);
    const ma = a.move(f1.id, f2.id);
    const mb = b.move(f2.id, f1.id);
    a.applyAll(mb);
    b.applyAll(ma);
    const da = a.toDocument();
    expect(dumpDocument(da)).toBe(dumpDocument(b.toDocument()));
    expect(da.size).toBe(2);
  });

  it('concurrent inserts at the same index keep a deterministic order', () => {
    const a = new Replica('a');
    const b = new Replica('b');
    const base = a.create('rect');
    b.applyAll(base.ops);
    const x = a.create('rect', {}, ROOT_ID, 0);
    const y = b.create('rect', {}, ROOT_ID, 0);
    a.applyAll(y.ops);
    b.applyAll(x.ops);
    const z = a.create('rect', {}, ROOT_ID, 1);
    b.applyAll(z.ops);
    expect(a.toDocument().root.children).toEqual(b.toDocument().root.children);
    expect(a.toDocument().root.children).toHaveLength(4);
  });

  it('inserting between equal sort keys still lands after them', () => {
    const a = new Replica('a');
    const b = new Replica('b');
    const x = a.create('rect');
    b.applyAll(x.ops);
    const ya = a.create('rect');
    const yb = b.create('rect');
    a.applyAll(yb.ops);
    b.applyAll(ya.ops);
    const z = a.create('rect', {}, ROOT_ID, 2);
    const kids = a.toDocument().root.children;
    expect(kids).toHaveLength(4);
    expect(kids.indexOf(z.id)).toBeGreaterThanOrEqual(2);
  });

  it('rebuilds from a snapshot', () => {
    const a = new Replica('a');
    const f = a.create('frame');
    a.create('text', { text: 'hi' }, f.id);
    const b = new Replica('b');
    b.applyAll(a.snapshot());
    expect(dumpDocument(b.toDocument())).toBe(dumpDocument(a.toDocument()));
  });
});

describe('convergence', () => {
  function randomRun(seed: number): void {
    const rand = rng(seed);
    const reps = ['a', 'b', 'c'].map((n) => new Replica(n));
    const all: Op[] = [];
    // inbox[i] = ops waiting to be delivered to replica i (any order, may duplicate)
    const inbox: Op[][] = reps.map(() => []);
    const ids: string[] = [];
    const types = ['rect', 'frame', 'group', 'text'] as const;

    const publish = (from: number, ops: Op[]): void => {
      all.push(...ops);
      inbox.forEach((q, i) => {
        if (i !== from) q.push(...ops);
      });
    };

    for (let step = 0; step < 150; step++) {
      const i = Math.floor(rand() * reps.length);
      const r = reps[i] as Replica;
      const pick = (): string | undefined => ids[Math.floor(rand() * ids.length)];
      const roll = rand();
      const target = pick();
      if (roll < 0.25 || !target) {
        const parent = rand() < 0.5 ? pick() : undefined;
        const made = r.create(
          types[Math.floor(rand() * types.length)] as 'rect',
          { x: Math.floor(rand() * 100) },
          parent ?? ROOT_ID,
          rand() < 0.5 ? 0 : undefined,
        );
        ids.push(made.id);
        publish(i, made.ops);
      } else if (roll < 0.55) {
        publish(
          i,
          r.set(target, { x: Math.floor(rand() * 100), fill: rand() < 0.5 ? '#f00' : null }),
        );
      } else if (roll < 0.75) {
        publish(i, r.move(target, pick() ?? ROOT_ID, Math.floor(rand() * 3)));
      } else if (roll < 0.85) {
        publish(i, r.remove(target));
      } else if (roll < 0.9) {
        publish(i, r.restore(target));
      } else {
        // Deliver a random chunk of this replica's inbox, shuffled, with duplicates.
        const q = inbox[i] as Op[];
        const take = q.splice(0, Math.floor(rand() * q.length));
        take.sort(() => rand() - 0.5);
        r.applyAll([...take, ...take.filter(() => rand() < 0.2)]);
      }
      // Ops that arrived for a node this replica has not created yet are fine: ops are order-free.
    }
    inbox.forEach((q, i) => {
      q.sort(() => rand() - 0.5);
      (reps[i] as Replica).applyAll(q);
    });

    const dumps = reps.map((r) => dumpDocument(r.toDocument()));
    expect(dumps[1]).toBe(dumps[0]);
    expect(dumps[2]).toBe(dumps[0]);

    const fresh = new Replica('z');
    fresh.applyAll([...all].sort(() => rand() - 0.5));
    expect(dumpDocument(fresh.toDocument())).toBe(dumps[0]);
  }

  it('3 replicas converge under random interleavings (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) randomRun(seed);
  });
});
