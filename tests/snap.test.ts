import { describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { Camera } from '../src/render/camera';
import { SceneIndex } from '../src/spatial/scene-index';
import { alignNodes, distributeNodes } from '../src/tools/align';
import { SelectTool } from '../src/tools/select-tool';
import { solveSnap } from '../src/tools/snap';

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('solveSnap', () => {
  it('snaps edges within the threshold and ignores farther ones', () => {
    const res = solveSnap(r(103, 0, 50, 50), [r(0, 200, 100, 40)], 8);
    expect(res.dx).toBe(-3); // left edge to target right edge (100)
    expect(res.dy).toBe(0);
    expect(solveSnap(r(120, 0, 50, 50), [r(0, 200, 100, 40)], 8).dx).toBe(0);
  });

  it('snaps centers and emits a guide spanning both rects', () => {
    const res = solveSnap(r(0, 0, 40, 40), [r(100, 100, 100, 100)], 8);
    expect(res).toMatchObject({ dx: 0, dy: 0 });
    const c = solveSnap(r(128, 0, 40, 40), [r(100, 100, 100, 100)], 8);
    expect(c.dx).toBe(2); // center 148 -> 150
    const g = c.guides.find((g) => g.axis === 'x' && g.pos === 150);
    expect(g).toMatchObject({ kind: 'align', from: 0, to: 200 });
  });

  it('picks the nearest candidate and snaps axes independently', () => {
    const res = solveSnap(r(96, 205, 20, 10), [r(0, 0, 100, 100), r(0, 200, 90, 100)], 8);
    expect(res.dx).toBe(4);
    expect(res.dy).toBe(-5);
  });

  it('snaps to equal spacing with a pair of static rects', () => {
    // Gap between A and B is 20; moving rect should sit 20 after B (B right = 150 -> x = 170).
    const a = r(0, 0, 50, 50);
    const b = r(70, 0, 80, 50);
    const res = solveSnap(r(174, 0, 30, 50), [a, b], 8);
    expect(res.dx).toBe(-4);
    expect(res.guides.filter((g) => g.kind === 'spacing').length).toBeGreaterThan(0);
  });

  it('centers between two rects', () => {
    const res = solveSnap(r(95, 300, 10, 10), [r(0, 0, 50, 50), r(150, 0, 50, 50)], 8);
    // Free space 50..150 = 100, moving width 10 -> x 95.
    expect(res.dx).toBe(0);
    expect(res.guides.some((g) => g.kind === 'spacing')).toBe(true);
    expect(solveSnap(r(98, 300, 10, 10), [r(0, 0, 50, 50), r(150, 0, 50, 50)], 8).dx).toBe(-3);
  });

  it('returns no change and no guides with no targets', () => {
    expect(solveSnap(r(5, 5, 5, 5), [], 8)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('SelectTool snapping', () => {
  function setup(zoom = 1) {
    const doc = new SceneDocument();
    const a = doc.add('rect', { x: 0, y: 0, width: 100, height: 100 }).id;
    const b = doc.add('rect', { x: 300, y: 300, width: 100, height: 100 }).id;
    const index = new SceneIndex(doc);
    const camera = new Camera();
    camera.zoom = zoom;
    const history = new History(doc);
    const tool = new SelectTool(doc, index, camera, () => undefined, history);
    return { doc, a, b, tool, history };
  }
  const no = { shift: false };

  it('snaps a dragged shape to a sibling edge and exposes guides', () => {
    const { doc, a, tool } = setup();
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerMove({ x: 50 + 150, y: 50 + 100 }, no); // far from any edge: untouched
    expect(doc.get(a).x).toBe(150);
    tool.pointerMove({ x: 50 + 297, y: 50 + 100 }, no); // raw 297 -> snaps to 300
    expect(doc.get(a).x).toBe(300);
    expect(tool.guides.length).toBeGreaterThan(0);
    tool.pointerUp();
    expect(tool.guides).toEqual([]);
  });

  it('threshold is 8 screen pixels regardless of zoom', () => {
    const { doc, a, tool } = setup(4);
    // At 4x, 8px = 2 world units. Screen (200,200) -> world (50,50).
    tool.pointerDown({ x: 200, y: 200 }, no);
    tool.pointerMove({ x: 200 + 4 * 297, y: 200 + 4 * 250 }, no);
    expect(doc.get(a).x).toBe(297); // 3 world units = 12px away: beyond the threshold
    tool.pointerMove({ x: 200 + 4 * 298.5, y: 200 + 4 * 250 }, no);
    expect(doc.get(a).x).toBe(300); // 1.5 units = 6px: snaps
  });

  it('Alt disables snapping and the move is one undo step', () => {
    const { doc, a, tool, history } = setup();
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerMove({ x: 347, y: 150 }, { shift: false, alt: true });
    expect(doc.get(a).x).toBe(297);
    tool.pointerMove({ x: 347, y: 150 }, no);
    expect(doc.get(a).x).toBe(300);
    tool.pointerUp();
    history.undo();
    expect(doc.get(a)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('align and distribute', () => {
  function setup() {
    const doc = new SceneDocument();
    const a = doc.add('rect', { x: 10, y: 0, width: 20, height: 20 }).id;
    const b = doc.add('rect', { x: 100, y: 50, width: 40, height: 10 }).id;
    const c = doc.add('rect', { x: 50, y: 90, width: 10, height: 10 }).id;
    return { doc, a, b, c, history: new History(doc) };
  }

  it('aligns to the selection bounds and undoes as one step', () => {
    const { doc, a, b, c, history } = setup();
    expect(alignNodes(doc, history, [a, b, c], 'left')).toBe(true);
    expect([a, b, c].map((i) => doc.get(i).x)).toEqual([10, 10, 10]);
    history.undo();
    expect([a, b, c].map((i) => doc.get(i).x)).toEqual([10, 100, 50]);
    alignNodes(doc, history, [a, b, c], 'right');
    expect([a, b, c].map((i) => doc.get(i).x + doc.get(i).width)).toEqual([140, 140, 140]);
    alignNodes(doc, history, [a, b, c], 'vcenter');
    expect([a, b, c].map((i) => doc.get(i).y + doc.get(i).height / 2)).toEqual([50, 50, 50]);
  });

  it('reports no-op when already aligned and aligns a lone child to its frame', () => {
    const { doc, a, b, history } = setup();
    expect(alignNodes(doc, history, [a, b], 'top')).toBe(true);
    expect(alignNodes(doc, history, [a, b], 'top')).toBe(false);
    const f = doc.add('frame', { x: 200, y: 200, width: 100, height: 100 }).id;
    const k = doc.add('rect', { x: 5, y: 5, width: 20, height: 20 }, f).id;
    expect(alignNodes(doc, history, [k], 'hcenter')).toBe(true);
    expect(doc.get(k).x).toBe(40);
    expect(alignNodes(doc, history, [a], 'left')).toBe(false); // root child: nothing to align to
  });

  it('distributes with equal gaps, keeping the outer two fixed', () => {
    const { doc, a, b, c, history } = setup();
    // x order: a(10..30), c(50..60), b(100..140): gaps 20 and 40 -> both 30.
    expect(distributeNodes(doc, history, [a, b, c], 'x')).toBe(true);
    expect(doc.get(a).x).toBe(10);
    expect(doc.get(c).x).toBe(60);
    expect(doc.get(b).x).toBe(100);
    expect(distributeNodes(doc, history, [a, b], 'x')).toBe(false);
    history.undo();
    expect(doc.get(c).x).toBe(50);
  });

  it('aligns correctly inside a rotated parent', () => {
    const doc = new SceneDocument();
    const history = new History(doc);
    const f = doc.add('frame', { x: 0, y: 0, width: 200, height: 200, rotation: Math.PI / 2 }).id;
    const p = doc.add('rect', { x: 0, y: 0, width: 10, height: 10 }, f).id;
    const q = doc.add('rect', { x: 50, y: 20, width: 10, height: 10 }, f).id;
    alignNodes(doc, history, [p, q], 'left');
    const wl = (i: string) => doc.worldBounds(i).x;
    expect(wl(p)).toBeCloseTo(wl(q));
  });
});
