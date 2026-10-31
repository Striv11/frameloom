import { describe, expect, it } from 'vitest';
import { RTree } from '../src/spatial/rtree';
import { prng } from '../src/app/demo';
import { rectsIntersect, type Rect } from '../src/model/matrix';

function randRect(rand: () => number, span = 2000): Rect {
  return { x: rand() * span, y: rand() * span, width: rand() * 60, height: rand() * 60 };
}

function brute(items: Map<string, Rect>, q: Rect): string[] {
  return [...items].filter(([, r]) => rectsIntersect(r, q)).map(([id]) => id);
}

const sorted = (a: string[]): string[] => [...a].sort();

describe('RTree', () => {
  it('handles empty trees', () => {
    const t = new RTree();
    expect(t.search({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(t.remove('nope')).toBe(false);
    t.validate();
  });

  it('counts touching rects as hits', () => {
    const t = new RTree();
    t.insert('a', { x: 0, y: 0, width: 10, height: 10 });
    expect(t.hitPoint({ x: 10, y: 10 })).toEqual(['a']);
    expect(t.hitPoint({ x: 10.5, y: 5 })).toEqual([]);
    expect(t.hitPoint({ x: 10.5, y: 5 }, 1)).toEqual(['a']);
  });

  it('rejects duplicate ids', () => {
    const t = new RTree();
    t.insert('a', { x: 0, y: 0, width: 1, height: 1 });
    expect(() => t.insert('a', { x: 0, y: 0, width: 1, height: 1 })).toThrow();
    expect(() =>
      t.load([
        { id: 'x', rect: { x: 0, y: 0, width: 1, height: 1 } },
        { id: 'x', rect: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    ).toThrow();
  });

  for (const seed of [1, 2, 3]) {
    it(`matches brute force on 10k shapes under random edits (seed ${seed})`, () => {
      const rand = prng(seed);
      const model = new Map<string, Rect>();
      const tree = new RTree();
      const initial = Array.from({ length: 10_000 }, (_, i) => ({
        id: `n${i}`,
        rect: randRect(rand),
      }));
      for (const it of initial) model.set(it.id, it.rect);
      if (seed % 2) tree.load(initial);
      else for (const it of initial) tree.insert(it.id, it.rect);
      tree.validate();
      expect(tree.size).toBe(10_000);

      let next = 10_000;
      for (let step = 0; step < 3000; step++) {
        const ids = [...model.keys()];
        const op = rand();
        if (op < 0.35) {
          const id = `n${next++}`;
          const r = randRect(rand);
          model.set(id, r);
          tree.insert(id, r);
        } else if (op < 0.7) {
          const id = ids[Math.floor(rand() * ids.length)]!;
          model.delete(id);
          expect(tree.remove(id)).toBe(true);
        } else {
          const id = ids[Math.floor(rand() * ids.length)]!;
          const r = randRect(rand);
          model.set(id, r);
          tree.update(id, r);
        }
        if (step % 500 === 0) tree.validate();
      }
      tree.validate();
      expect(tree.size).toBe(model.size);

      for (let q = 0; q < 200; q++) {
        const rect = randRect(rand);
        rect.width *= 4;
        rect.height *= 4;
        expect(sorted(tree.search(rect))).toEqual(sorted(brute(model, rect)));
        const p = { x: rand() * 2000, y: rand() * 2000 };
        expect(sorted(tree.hitPoint(p))).toEqual(
          sorted(brute(model, { x: p.x, y: p.y, width: 0, height: 0 })),
        );
      }
    });
  }

  it('shrinks back to empty when everything is removed', () => {
    const rand = prng(9);
    const t = new RTree();
    const ids = Array.from({ length: 500 }, (_, i) => `n${i}`);
    for (const id of ids) t.insert(id, randRect(rand));
    for (const id of ids) {
      t.remove(id);
    }
    t.validate();
    expect(t.size).toBe(0);
    t.insert('z', { x: 1, y: 1, width: 1, height: 1 });
    expect(t.hitPoint({ x: 1.5, y: 1.5 })).toEqual(['z']);
  });

  it('hit-tests 10k shapes in well under 0.1 ms (median)', () => {
    const rand = prng(5);
    const t = new RTree();
    t.load(Array.from({ length: 10_000 }, (_, i) => ({ id: `n${i}`, rect: randRect(rand) })));
    const times: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const p = { x: rand() * 2000, y: rand() * 2000 };
      const t0 = performance.now();
      t.hitPoint(p);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[times.length >> 1]!).toBeLessThan(0.1);
  });
});
