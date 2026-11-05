import { beforeEach, describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { applyToPoint } from '../src/model/matrix';
import { Camera } from '../src/render/camera';
import { SceneIndex } from '../src/spatial/scene-index';
import { handlePoints, hitHandle, selectionFrame } from '../src/tools/handles';
import { marqueeSelect, pickAt, topLevelOnly } from '../src/tools/selection';
import { SelectTool } from '../src/tools/select-tool';

const no = { shift: false };
const shift = { shift: true };

let doc: SceneDocument;
let index: SceneIndex;
let camera: Camera;
let tool: SelectTool;
let a: string, b: string, c: string;

beforeEach(() => {
  doc = new SceneDocument();
  a = doc.add('rect', { x: 0, y: 0, width: 100, height: 100 }).id;
  b = doc.add('rect', { x: 200, y: 0, width: 100, height: 100 }).id;
  c = doc.add('ellipse', { x: 0, y: 200, width: 100, height: 100 }).id;
  index = new SceneIndex(doc);
  camera = new Camera(); // identity: screen == world
  tool = new SelectTool(doc, index, camera);
});

describe('click selection', () => {
  it('selects on click and replaces on another click', () => {
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerUp();
    expect(tool.selection.ids).toEqual([a]);
    tool.pointerDown({ x: 250, y: 50 }, no);
    tool.pointerUp();
    expect(tool.selection.ids).toEqual([b]);
  });

  it('shift-click adds and removes', () => {
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerUp();
    tool.pointerDown({ x: 250, y: 50 }, shift);
    tool.pointerUp();
    expect(tool.selection.ids).toEqual([a, b]);
    tool.pointerDown({ x: 50, y: 50 }, shift);
    tool.pointerUp();
    expect(tool.selection.ids).toEqual([b]);
  });

  it('clicking empty space clears the selection', () => {
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerUp();
    tool.pointerDown({ x: 500, y: 500 }, no);
    tool.pointerUp();
    expect(tool.selection.size).toBe(0);
  });

  it('selects a group as a unit but a frame child directly', () => {
    const g = doc.add('group', { x: 400, y: 0, width: 10, height: 10 });
    const inG = doc.add('rect', { x: 0, y: 0, width: 50, height: 50 }, g.id).id;
    const f = doc.add('frame', { x: 600, y: 0, width: 200, height: 200 });
    const inF = doc.add('rect', { x: 10, y: 10, width: 50, height: 50 }, f.id).id;
    index.rebuild();
    expect(pickAt(doc, index, { x: 420, y: 20 })).toBe(g.id);
    expect(pickAt(doc, index, { x: 620, y: 20 })).toBe(inF);
    expect(inG).toBeDefined();
    expect(pickAt(doc, index, { x: 750, y: 150 })).toBe(f.id);
  });
});

describe('moving', () => {
  it('drags the selection and refreshes the index', () => {
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerMove({ x: 80, y: 90 }, no);
    tool.pointerUp();
    expect(doc.get(a)).toMatchObject({ x: 30, y: 40 });
    expect(index.hitTest({ x: 120, y: 130 })).toBe(a);
    expect(index.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('moves all selected nodes together, and respects zoom', () => {
    camera.zoomAt({ x: 0, y: 0 }, 2);
    tool.selection.replace([a, b]);
    tool.pointerDown({ x: 100, y: 100 }, no); // world (50, 50) is on a
    tool.pointerMove({ x: 120, y: 100 }, no); // +10 world units
    tool.pointerUp();
    expect(doc.get(a).x).toBeCloseTo(10);
    expect(doc.get(b).x).toBeCloseTo(210);
  });

  it('does not double-move a node whose ancestor is also selected', () => {
    const g = doc.add('group', { x: 400, y: 0, width: 10, height: 10 });
    const kid = doc.add('rect', { x: 5, y: 5, width: 50, height: 50 }, g.id).id;
    index.rebuild();
    tool.selection.replace([g.id, kid]);
    tool.pointerDown({ x: 420, y: 20 }, no);
    tool.pointerMove({ x: 430, y: 20 }, no);
    tool.pointerUp();
    expect(doc.get(g.id).x).toBe(410);
    expect(doc.get(kid).x).toBe(5);
  });

  it('cancel restores the original geometry', () => {
    tool.pointerDown({ x: 50, y: 50 }, no);
    tool.pointerMove({ x: 150, y: 150 }, no);
    tool.cancel();
    expect(doc.get(a)).toMatchObject({ x: 0, y: 0 });
    expect(tool.dragging).toBe(false);
  });

  it('follows the pointer inside a rotated frame', () => {
    const f = doc.add('frame', { x: 500, y: 500, width: 300, height: 300, rotation: Math.PI / 2 });
    const kid = doc.add('rect', { x: 10, y: 10, width: 40, height: 40 }, f.id);
    index.rebuild();
    const startWorld = applyToPoint(doc.worldMatrix(kid.id), { x: 20, y: 20 });
    tool.pointerDown(startWorld, no);
    expect(tool.selection.ids).toEqual([kid.id]);
    tool.pointerMove({ x: startWorld.x + 30, y: startWorld.y + 10 }, no);
    tool.pointerUp();
    const now = applyToPoint(doc.worldMatrix(kid.id), { x: 20, y: 20 });
    expect(now.x).toBeCloseTo(startWorld.x + 30, 9);
    expect(now.y).toBeCloseTo(startWorld.y + 10, 9);
  });
});

describe('marquee', () => {
  it('selects touched nodes and updates live', () => {
    tool.pointerDown({ x: -10, y: -10 }, no);
    tool.pointerMove({ x: 110, y: 110 }, no);
    expect(tool.selection.ids).toEqual([a]);
    expect(tool.marquee).toEqual({ x: -10, y: -10, width: 120, height: 120 });
    tool.pointerMove({ x: 320, y: 110 }, no);
    expect(tool.selection.ids).toEqual([a, b]);
    tool.pointerMove({ x: 10, y: 10 }, no);
    expect(tool.selection.ids).toEqual([a]);
    tool.pointerUp();
    expect(tool.marquee).toBeNull();
  });

  it('shift-marquee adds to the existing selection', () => {
    tool.selection.replace([c]);
    tool.pointerDown({ x: 190, y: -10 }, shift);
    tool.pointerMove({ x: 310, y: 110 }, shift);
    tool.pointerUp();
    expect(tool.selection.ids.sort()).toEqual([b, c].sort());
  });

  it('requires frames to be fully enclosed and resolves group members to the group', () => {
    const f = doc.add('frame', { x: 1000, y: 0, width: 200, height: 200 });
    doc.add('rect', { x: 10, y: 10, width: 20, height: 20 }, f.id);
    const g = doc.add('group', { x: 400, y: 0, width: 10, height: 10 });
    doc.add('rect', { x: 0, y: 0, width: 50, height: 50 }, g.id);
    doc.add('rect', { x: 100, y: 0, width: 50, height: 50 }, g.id);
    index.rebuild();
    const inside = marqueeSelect(doc, index, { x: 1005, y: 5, width: 40, height: 40 });
    expect(inside).toHaveLength(1);
    expect(doc.get(inside[0] as string).type).toBe('rect');
    expect(marqueeSelect(doc, index, { x: 990, y: -10, width: 230, height: 230 })).toEqual([f.id]);
    expect(marqueeSelect(doc, index, { x: 520, y: 10, width: 10, height: 10 })).toEqual([g.id]);
  });

  it('ignores locked and hidden nodes', () => {
    doc.update(a, { locked: true });
    doc.update(b, { visible: false });
    expect(marqueeSelect(doc, index, { x: -10, y: -10, width: 400, height: 120 })).toEqual([]);
  });
});

describe('handles', () => {
  it('resizes via the south-east handle', () => {
    tool.selection.replace([a]);
    const frame = tool.frame();
    expect(frame?.resizable).toBe(true);
    tool.pointerDown({ x: 100, y: 100 }, no);
    tool.pointerMove({ x: 160, y: 130 }, no);
    tool.pointerUp();
    expect(doc.get(a)).toMatchObject({ x: 0, y: 0, width: 160, height: 130 });
    expect(index.hitTest({ x: 150, y: 120 })).toBe(a);
  });

  it('rotates via the rotate handle about the center', () => {
    tool.selection.replace([a]);
    const rot = handlePoints(tool.frame()!, camera).find((h) => h.kind === 'rotate')!;
    expect(rot.screen).toEqual({ x: 50, y: -24 });
    tool.pointerDown(rot.screen, no);
    tool.pointerMove({ x: 200, y: 50 }, no); // swept from straight up to the right: +90°
    tool.pointerUp();
    expect(doc.get(a).rotation).toBeCloseTo(Math.PI / 2, 9);
    const center = applyToPoint(doc.worldMatrix(a), { x: 50, y: 50 });
    expect(center.x).toBeCloseTo(50, 9);
    expect(center.y).toBeCloseTo(50, 9);
  });

  it('puts the rotate handle outside a rotated box', () => {
    doc.update(a, { rotation: Math.PI / 2 });
    const frame = selectionFrame(doc, [a])!;
    const rot = handlePoints(frame, camera).find((h) => h.kind === 'rotate')!;
    // Rotated 90° clockwise about the top-left: the box spans x in [-100, 0] and its
    // top edge faces +x, so the handle sits 24px to the right of the edge midpoint (0, 50).
    expect(rot.screen.x).toBeCloseTo(24, 9);
    expect(rot.screen.y).toBeCloseTo(50, 9);
  });

  it('multi-selection frame is the union AABB and has no handles', () => {
    const frame = selectionFrame(doc, [a, b])!;
    expect(frame.width).toBe(300);
    expect(frame.height).toBe(100);
    expect(handlePoints(frame, camera)).toEqual([]);
    expect(hitHandle(frame, camera, { x: 300, y: 100 })).toBeNull();
  });

  it('lines rotate but do not resize', () => {
    const l = doc.add('line', { x: 0, y: 400, width: 100, height: -50 }).id;
    const kinds = handlePoints(selectionFrame(doc, [l])!, camera).map((h) => h.kind);
    expect(kinds).toEqual(['rotate']);
  });
});

describe('topLevelOnly', () => {
  it('drops descendants of selected ancestors', () => {
    const g = doc.add('group', {});
    const k = doc.add('rect', {}, g.id).id;
    expect(topLevelOnly(doc, [g.id, k, a])).toEqual([g.id, a]);
  });
});

describe('drop to reparent', () => {
  it('drops a dragged shape into a frame, keeping its world position, as one undo step', () => {
    const history = new History(doc);
    const frame = doc.add('frame', { x: 400, y: 400, width: 300, height: 300 }).id;
    index.rebuild();
    const t = new SelectTool(doc, index, camera, () => undefined, history);
    t.snapEnabled = false; // these tests assert raw drag geometry, not snapping
    t.pointerDown({ x: 50, y: 50 }, no);
    t.pointerMove({ x: 450, y: 450 }, no);
    t.pointerUp();
    expect(doc.get(a).parentId).toBe(frame);
    expect(applyToPoint(doc.worldMatrix(a), { x: 0, y: 0 })).toEqual({ x: 400, y: 400 });
    history.undo();
    expect(doc.get(a).parentId).toBe('root');
    expect(doc.get(a)).toMatchObject({ x: 0, y: 0 });
    expect(doc.get(frame).children).toEqual([]);
    history.redo();
    expect(doc.get(a).parentId).toBe(frame);
    expect(doc.get(a)).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps world transform when dropping into a rotated frame', () => {
    const frame = doc.add('frame', {
      x: 600,
      y: 0,
      width: 300,
      height: 300,
      rotation: Math.PI / 6,
    }).id;
    index.rebuild();
    const before = applyToPoint(doc.worldMatrix(b), { x: 0, y: 0 });
    const t = new SelectTool(doc, index, camera, () => undefined, new History(doc));
    t.snapEnabled = false; // these tests assert raw drag geometry, not snapping
    t.pointerDown({ x: 250, y: 50 }, no);
    t.pointerMove({ x: 700, y: 100 }, no);
    t.pointerUp();
    expect(doc.get(b).parentId).toBe(frame);
    const after = applyToPoint(doc.worldMatrix(b), { x: 0, y: 0 });
    expect(after.x).toBeCloseTo(before.x + 450, 6);
    expect(after.y).toBeCloseTo(before.y + 50, 6);
  });

  it('drops out of a frame onto the canvas', () => {
    const frame = doc.add('frame', { x: 400, y: 400, width: 300, height: 300 }).id;
    const inner = doc.add('rect', { x: 10, y: 10, width: 50, height: 50 }, frame).id;
    index.rebuild();
    const history = new History(doc);
    const t = new SelectTool(doc, index, camera, () => undefined, history);
    t.snapEnabled = false; // these tests assert raw drag geometry, not snapping
    t.pointerDown({ x: 430, y: 430 }, no);
    t.pointerMove({ x: 1000, y: 1000 }, no);
    t.pointerUp();
    expect(doc.get(inner).parentId).toBe('root');
    expect(applyToPoint(doc.worldMatrix(inner), { x: 0, y: 0 })).toEqual({ x: 980, y: 980 });
    history.undo();
    expect(doc.get(inner).parentId).toBe(frame);
    expect(doc.get(inner)).toMatchObject({ x: 10, y: 10 });
  });

  it('does not reparent on a plain click or into a frame being moved', () => {
    const frame = doc.add('frame', { x: 0, y: 0, width: 500, height: 500 }).id;
    index.rebuild();
    tool.pointerDown({ x: 250, y: 50 }, no);
    tool.pointerUp();
    expect(doc.get(b).parentId).toBe('root');
    tool.pointerDown({ x: 250, y: 450 }, no); // empty part of the frame: selects the frame
    tool.pointerMove({ x: 260, y: 460 }, no);
    tool.pointerUp();
    expect(doc.get(frame).parentId).toBe('root');
  });
});
