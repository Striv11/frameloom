import { withOverrides } from '../model/components';
import type { NodePatch, SceneDocument } from '../model/document';
import { snapshotSubtree, type History } from '../model/history';
import { applyToPoint, invert, type Point } from '../model/matrix';
import type { NodeId, TextNode } from '../model/types';
import type { Camera } from '../render/camera';
import type { SceneIndex } from '../spatial/scene-index';
import { frameAt } from './create-tool';

/** Measures the unwrapped size of text; injected so the tool stays DOM-free. */
export type TextMeasure = (
  text: string,
  fontSize: number,
  fontFamily: string,
) => { width: number; height: number };

/** Deterministic fallback metrics (used in tests and before a canvas exists). */
export const approximateMeasure: TextMeasure = (text, fontSize) => {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => l.length), 0);
  return {
    width: Math.ceil(longest * fontSize * 0.6),
    height: Math.ceil(lines.length * fontSize * 1.25),
  };
};

interface Session {
  id: NodeId;
  /** `null` when editing a node that already existed. */
  created: boolean;
  /** Text before the session began (existing nodes only). */
  original: string;
  /** Overrides before the session (nodes inside component instances). */
  originalOverrides: Record<string, string | number | boolean | null>;
}

/**
 * Text tool (DOM-free). A click starts a session on a new empty text node;
 * `edit(id)` starts one on an existing node. The host feeds `setText` from a
 * textarea; `commit()` records one undo step (create, or text change) and
 * discards new nodes that stay empty. `cancel()` restores the prior state.
 */
export class TextTool {
  private session: Session | null = null;

  constructor(
    private readonly doc: SceneDocument,
    private readonly index: SceneIndex,
    private readonly camera: Camera,
    private readonly measure: TextMeasure = approximateMeasure,
    private readonly onChange: () => void = () => undefined,
    private readonly history: History | null = null,
  ) {}

  get active(): boolean {
    return this.session !== null;
  }

  /** Id of the node being edited, if any. */
  get editing(): NodeId | null {
    return this.session?.id ?? null;
  }

  /** Starts a new text node at the screen point. Any open session is committed first. */
  begin(screen: Point): NodeId | null {
    this.commit();
    const world = this.camera.screenToWorld(screen);
    const parentId = frameAt(this.doc, world);
    const inv = invert(this.doc.worldMatrix(parentId));
    if (!inv) return null;
    const p = applyToPoint(inv, world);
    const node = this.doc.add('text', { x: p.x, y: p.y, text: '' }, parentId);
    this.session = { id: node.id, created: true, original: '', originalOverrides: {} };
    this.fit(node as TextNode);
    this.index.rebuild();
    this.onChange();
    return node.id;
  }

  /** Starts editing an existing text node. Returns false for other node types. */
  edit(id: NodeId): boolean {
    this.commit();
    if (!this.doc.has(id)) return false;
    const node = this.doc.get(id);
    if (node.type !== 'text') return false;
    this.session = {
      id,
      created: false,
      original: node.text,
      originalOverrides: { ...(node.overrides ?? {}) },
    };
    return true;
  }

  /** Live update from the editor; resizes the node to fit its content. */
  setText(text: string): void {
    const s = this.session;
    if (!s) return;
    const node = this.doc.get(s.id) as TextNode;
    this.doc.update(s.id, { text });
    this.fit(node);
    this.index.refresh(s.id);
    this.onChange();
  }

  /** Ends the session, recording history. Returns the surviving node id, or null if discarded. */
  commit(): NodeId | null {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    const node = this.doc.get(s.id) as TextNode;
    if (s.created) {
      if (node.text.trim() === '') {
        this.doc.remove(s.id);
        this.index.rebuild();
        this.onChange();
        return null;
      }
      this.history?.record('Create text', snapshotSubtree(this.doc, s.id), {
        kind: 'remove',
        id: s.id,
      });
    } else if (node.text !== s.original) {
      this.history?.record(
        'Edit text',
        this.update(s.id, node.text, node, false, s.originalOverrides),
        this.update(s.id, s.original, node, true, s.originalOverrides),
      );
    }
    this.onChange();
    return s.id;
  }

  cancel(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.created) this.doc.remove(s.id);
    else {
      this.doc.update(s.id, { text: s.original });
      this.fit(this.doc.get(s.id) as TextNode);
      this.index.refresh(s.id);
    }
    this.index.rebuild();
    this.onChange();
  }

  /** Update op that also carries the box size, so undo restores geometry too. */
  private update(
    id: NodeId,
    text: string,
    node: TextNode,
    undoing: boolean,
    originalOverrides: NonNullable<TextNode['overrides']>,
  ) {
    const size = undoing ? this.box(text, node) : node;
    const patch = { text, width: size.width, height: size.height };
    // Text edited inside a component instance becomes a per-instance override.
    const full = undoing
      ? node.sourceId === undefined
        ? patch
        : { ...patch, overrides: originalOverrides }
      : withOverrides(node, patch);
    return { kind: 'update' as const, id, patch: full as NodePatch };
  }

  private box(text: string, node: TextNode): { width: number; height: number } {
    const { width, height } = this.measure(text, node.fontSize, node.fontFamily);
    return { width: Math.max(width, 1), height: Math.max(height, node.fontSize) };
  }

  private fit(node: TextNode): void {
    this.doc.update(node.id, this.box(node.text, node));
  }
}
