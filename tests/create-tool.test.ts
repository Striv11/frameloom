import { beforeEach, describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { applyToPoint } from '../src/model/matrix';
import { Camera } from '../src/render/camera';
import { SceneIndex } from '../src/spatial/scene-index';
import { CreateTool, shapeBox, TOOL_SHORTCUTS } from '../src/tools/create-tool';

const no = { shift: false };
const shift = { shift: true };

let doc: SceneDocument;
let index: SceneIndex;
let tool: CreateTool;
let created: string[];

beforeEach(() => {
  doc = new SceneDocument();
  index = new SceneIndex(doc);
  created = [];
  tool = new CreateTool(doc, index, new Camera(), (id) => created.push(id));
});

function drag(from: [number, number], to: [number, number], mods = no): string | null {
  tool.pointerDown({ x: from[0], y: from[1] });
  tool.pointerMove({ x: to[0], y: to[1] }, mods);
  return tool.pointerUp({ x: to[0], y: to[1] });
}

describe('shapeBox', () => {
  it('normalizes a rect dragged up and left', () => {
    expect(shapeBox('rect', { x: 100, y: 100 }, { x: 40, y: 70 }, false)).toEqual({
      x: 40,
      y: 70,
      width: 60,
      height: 30,
    });
  });
  it('shift makes a square growing toward the pointer', () => {
    expect(shapeBox('ellipse', { x: 100, y: 100 }, { x: 40, y: 90 }, true)).toEqual({
      x: 40,
      y: 40,
      width: 60,
      height: 60,
    });
  });
  it('lines keep direction as signed width/height', () => {
    expect(shapeBox('line', { x: 10, y: 10 }, { x: 0, y: 30 }, false)).toEqual({
      x: 10,
      y: 10,
      width: -10,
      height: 20,
    });
  });
  it('shift snaps lines to 45° and preserves length', () => {
    const b = shapeBox('line', { x: 0, y: 0 }, { x: 100, y: 10 }, true);
    expect(b.height).toBe(0);
    expect(b.width).toBeCloseTo(Math.hypot(100, 10));
    const d = shapeBox('line', { x: 0, y: 0 }, { x: 50, y: 60 }, true);
    expect(d.width).toBeCloseTo(d.height);
  });
});

describe('CreateTool', () => {
  it.each(['rect', 'ellipse', 'line'] as const)('creates a %s on drag', (kind) => {
    tool.kind = kind;
    const id = drag([10, 20], [110, 80]);
    expect(id).not.toBeNull();
    expect(created).toEqual([id]);
    const n = doc.get(id!);
    expect(n.type).toBe(kind);
    expect([n.x, n.y, n.width, n.height]).toEqual([10, 20, 100, 60]);
    expect(n.parentId).toBe(doc.root.id);
    expect(index.tree.size).toBe(1);
    if (kind !== 'line') expect(index.hitTest({ x: 60, y: 50 })).toBe(id);
  });

  it('shows the shape live and discards a plain click', () => {
    tool.pointerDown({ x: 5, y: 5 });
    tool.pointerMove({ x: 50, y: 50 }, no);
    expect(doc.size).toBe(1);
    tool.pointerUp({ x: 5, y: 5 });
    expect(doc.size).toBe(0);
    expect(created).toEqual([]);
    expect(index.tree.size).toBe(0);
  });

  it('cancel removes the in-progress shape', () => {
    tool.pointerDown({ x: 5, y: 5 });
    tool.pointerMove({ x: 50, y: 50 }, no);
    tool.cancel();
    expect(doc.size).toBe(0);
    expect(tool.dragging).toBe(false);
    expect(created).toEqual([]);
  });

  it('shift constrains to a square', () => {
    const id = drag([0, 0], [80, 30], shift)!;
    expect(doc.get(id).width).toBe(80);
    expect(doc.get(id).height).toBe(80);
  });

  it('parents into the topmost frame under the pointer using local coordinates', () => {
    doc.add('frame', { x: 100, y: 100, width: 300, height: 300 });
    const inner = doc.add('frame', { x: 50, y: 50, width: 100, height: 100 }, 'n1');
    index.rebuild();
    const id = drag([170, 170], [200, 190])!;
    const n = doc.get(id);
    expect(n.parentId).toBe(inner.id);
    expect([n.x, n.y, n.width, n.height]).toEqual([20, 20, 30, 20]);
    const w = applyToPoint(doc.worldMatrix(id), { x: 0, y: 0 });
    expect(w).toEqual({ x: 170, y: 170 });
  });

  it('falls back to the root for rotated frames and outside frames', () => {
    doc.add('frame', { x: 0, y: 0, width: 200, height: 200, rotation: 0.3 });
    index.rebuild();
    expect(doc.get(drag([50, 50], [90, 90])!).parentId).toBe(doc.root.id);
    doc.add('frame', { x: 500, y: 500, width: 50, height: 50 });
    expect(doc.get(drag([10, 300], [60, 340])!).parentId).toBe(doc.root.id);
  });

  it('accounts for camera zoom and pan', () => {
    const cam = new Camera();
    cam.zoomAt({ x: 0, y: 0 }, 2);
    cam.panBy(20, 40);
    const t = new CreateTool(doc, index, cam);
    t.pointerDown({ x: 20, y: 40 });
    t.pointerMove({ x: 120, y: 140 }, no);
    const id = t.pointerUp({ x: 120, y: 140 })!;
    expect([doc.get(id).x, doc.get(id).y, doc.get(id).width]).toEqual([0, 0, 50]);
  });
});

describe('shortcuts', () => {
  it('maps V/R/O/L', () => {
    expect(TOOL_SHORTCUTS).toEqual({ v: 'select', r: 'rect', o: 'ellipse', l: 'line' });
  });
});
