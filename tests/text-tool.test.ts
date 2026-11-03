import { beforeEach, describe, expect, it } from 'vitest';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { Camera } from '../src/render/camera';
import { SceneIndex } from '../src/spatial/scene-index';
import { TextTool } from '../src/tools/text-tool';
import type { TextNode } from '../src/model/types';

let doc: SceneDocument;
let index: SceneIndex;
let history: History;
let tool: TextTool;

beforeEach(() => {
  doc = new SceneDocument();
  index = new SceneIndex(doc);
  history = new History(doc);
  tool = new TextTool(doc, index, new Camera(), undefined, undefined, history);
});

describe('TextTool', () => {
  it('creates a text node that grows with its content and is hit-testable', () => {
    const id = tool.begin({ x: 50, y: 60 }) as string;
    tool.setText('Hello');
    const n = doc.get(id) as TextNode;
    expect(n).toMatchObject({ x: 50, y: 60, text: 'Hello' });
    expect(n.width).toBeGreaterThan(20);
    tool.setText('Hello\nWorld!!');
    const taller = (doc.get(id) as TextNode).height;
    expect(taller).toBeGreaterThan(n.height - 1);
    expect(index.hitTest({ x: 55, y: 65 })).toBe(id);
    expect(tool.commit()).toBe(id);
    expect(tool.active).toBe(false);
  });

  it('discards a text node left empty, with no history entry', () => {
    tool.begin({ x: 10, y: 10 });
    tool.setText('   ');
    expect(tool.commit()).toBeNull();
    expect(doc.size).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it('create is one undo step and redo restores the text', () => {
    const id = tool.begin({ x: 0, y: 0 }) as string;
    tool.setText('abc');
    tool.commit();
    history.undo();
    expect(doc.has(id)).toBe(false);
    history.redo();
    expect((doc.get(id) as TextNode).text).toBe('abc');
  });

  it('editing an existing node undoes text and size together', () => {
    const id = tool.begin({ x: 0, y: 0 }) as string;
    tool.setText('ab');
    tool.commit();
    const before = { ...(doc.get(id) as TextNode) };
    expect(tool.edit(id)).toBe(true);
    tool.setText('abcdefgh');
    expect(tool.commit()).toBe(id);
    expect((doc.get(id) as TextNode).width).toBeGreaterThan(before.width);
    history.undo();
    expect(doc.get(id)).toMatchObject({ text: 'ab', width: before.width, height: before.height });
    history.redo();
    expect((doc.get(id) as TextNode).text).toBe('abcdefgh');
  });

  it('unchanged edits record nothing; cancel restores the original', () => {
    const id = tool.begin({ x: 0, y: 0 }) as string;
    tool.setText('keep');
    tool.commit();
    history.clear();
    tool.edit(id);
    tool.commit();
    expect(history.canUndo).toBe(false);
    tool.edit(id);
    tool.setText('changed and longer');
    tool.cancel();
    expect((doc.get(id) as TextNode).text).toBe('keep');
    expect(history.canUndo).toBe(false);
  });

  it('cancel on a new node removes it; edit rejects non-text nodes', () => {
    const id = tool.begin({ x: 0, y: 0 }) as string;
    tool.setText('x');
    tool.cancel();
    expect(doc.has(id)).toBe(false);
    const r = doc.add('rect', {});
    expect(tool.edit(r.id)).toBe(false);
  });

  it('parents into a frame using frame-local coordinates', () => {
    const f = doc.add('frame', { x: 100, y: 100, width: 300, height: 300 });
    const id = tool.begin({ x: 150, y: 170 }) as string;
    expect(doc.get(id)).toMatchObject({ parentId: f.id, x: 50, y: 70 });
  });
});
