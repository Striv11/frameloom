import { beforeEach, describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { pathBounds } from '../src/model/path';
import { Camera } from '../src/render/camera';
import { SceneIndex } from '../src/spatial/scene-index';
import { PenTool } from '../src/tools/pen-tool';
import type { PathNode } from '../src/model/types';

let doc: SceneDocument;
let index: SceneIndex;
let history: History;
let pen: PenTool;
let created: string[];

beforeEach(() => {
  doc = new SceneDocument();
  index = new SceneIndex(doc);
  history = new History(doc);
  created = [];
  pen = new PenTool(
    doc,
    index,
    new Camera(),
    (id) => created.push(id),
    () => undefined,
    history,
  );
});

const click = (x: number, y: number): void => {
  pen.pointerDown({ x, y });
  pen.pointerUp();
};
const pathNodes = (): PathNode[] =>
  [...doc.paintOrder()].filter((n): n is PathNode => n.type === 'path');

describe('PenTool', () => {
  it('clicks build a polyline of corner anchors, normalized to its bounds', () => {
    click(100, 50);
    click(180, 50);
    click(180, 130);
    expect(pen.active).toBe(true);
    const id = pen.finish();
    expect(id).not.toBeNull();
    const [n] = pathNodes();
    expect(n).toMatchObject({ x: 100, y: 50, width: 80, height: 80, closed: false });
    expect(n?.anchors.map((a) => [a.x, a.y])).toEqual([
      [0, 0],
      [80, 0],
      [80, 80],
    ]);
    expect(created).toEqual([id]);
  });

  it('click-drag pulls a symmetric handle and bounds follow the curve', () => {
    click(0, 0);
    pen.pointerDown({ x: 100, y: 0 });
    pen.pointerMove({ x: 100, y: 100 });
    pen.pointerUp();
    pen.finish();
    const n = pathNodes()[0] as PathNode;
    const last = n.anchors[1];
    expect(last).toMatchObject({ outX: 0, outY: 100, inX: 0, inY: -100 });
    // Bounds come from the curve, so height stays well under the handle reach.
    const b = pathBounds(n.anchors, n.closed);
    expect(n.height).toBeCloseTo(b?.height ?? -1);
    expect(n.height).toBeLessThan(100);
  });

  it('tiny drags count as corner clicks', () => {
    click(10, 10);
    pen.pointerDown({ x: 60, y: 10 });
    pen.pointerMove({ x: 61, y: 11 });
    pen.pointerUp();
    pen.finish();
    expect(pathNodes()[0]?.anchors[1]).toMatchObject({ outX: 0, outY: 0 });
  });

  it('clicking the first anchor closes and commits the path', () => {
    click(0, 0);
    click(100, 0);
    click(100, 100);
    click(3, 4); // within the close radius of (0,0)
    expect(pen.active).toBe(false);
    const n = pathNodes()[0] as PathNode;
    expect(n.closed).toBe(true);
    expect(n.anchors).toHaveLength(3);
    expect(created).toHaveLength(1);
  });

  it('a single anchor is discarded on finish', () => {
    click(5, 5);
    expect(pen.finish()).toBeNull();
    expect(pathNodes()).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(history.canUndo).toBe(false);
  });

  it('cancel removes the in-progress path', () => {
    click(0, 0);
    click(50, 50);
    pen.cancel();
    expect(pathNodes()).toHaveLength(0);
    expect(pen.active).toBe(false);
  });

  it('is one undo step and redo restores the same anchors', () => {
    click(0, 0);
    click(100, 20);
    pen.pointerDown({ x: 200, y: 100 });
    pen.pointerMove({ x: 240, y: 140 });
    pen.pointerUp();
    pen.finish();
    const before = JSON.stringify(pathNodes());
    expect(history.undo()).toBe(true);
    expect(pathNodes()).toHaveLength(0);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe(true);
    expect(JSON.stringify(pathNodes())).toBe(before);
  });

  it('ignores a repeated click on the same spot', () => {
    click(10, 10);
    click(10, 10);
    expect(pen.anchorCount).toBe(1);
  });

  it('draws inside an un-rotated frame in its local space', () => {
    const f = doc.add('frame', { x: 100, y: 100, width: 300, height: 300 });
    click(150, 160);
    click(250, 160);
    pen.finish();
    const n = pathNodes()[0] as PathNode;
    expect(n.parentId).toBe(f.id);
    expect(n).toMatchObject({ x: 50, y: 60 });
    expect(doc.worldBounds(n.id)).toMatchObject({ x: 150, y: 160, width: 100 });
  });

  it('works under the index: committed open paths hit-test on the stroke only', () => {
    click(0, 0);
    click(100, 0);
    click(100, 100);
    pen.finish();
    const id = pathNodes()[0]?.id;
    expect(index.hitTest({ x: 50, y: 0 })).toBe(id);
    expect(index.hitTest({ x: 40, y: 60 })).toBeNull(); // inside bbox, off the stroke
  });
});
