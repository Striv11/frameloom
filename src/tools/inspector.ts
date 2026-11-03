import type { SceneDocument } from '../model/document';
import type { History, Op } from '../model/history';
import type { NodeId, SceneNode } from '../model/types';

export type FieldKey =
  'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'fill' | 'stroke' | 'strokeWidth';

/** Value shown in the inspector: a concrete value, or `mixed` when nodes disagree. */
export type FieldValue<T> = { mixed: false; value: T } | { mixed: true };

export interface InspectorField {
  key: FieldKey;
  kind: 'number' | 'paint';
  /** False when no selected node accepts edits to this field. */
  editable: boolean;
  /** Displayed unit conversion: rotation is shown in degrees, opacity in percent. */
  value: FieldValue<number | string | null>;
}

const NUMBER_KEYS: readonly FieldKey[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'strokeWidth',
];
const PAINT_KEYS: readonly FieldKey[] = ['fill', 'stroke'];

const RAD = Math.PI / 180;

/** Whether `key` can be edited on `node`. Size is derived for text, lines, paths and groups. */
export function isEditable(node: SceneNode, key: FieldKey): boolean {
  switch (key) {
    case 'width':
    case 'height':
      return node.type === 'rect' || node.type === 'ellipse' || node.type === 'frame';
    case 'fill':
      return node.type !== 'line' && node.type !== 'group';
    case 'stroke':
    case 'strokeWidth':
      return node.type !== 'group' && node.type !== 'text';
    default:
      return true;
  }
}

/** Converts a stored value into the units shown to the user. */
function display(key: FieldKey, node: SceneNode): number | string | null {
  const v = node[key];
  if (key === 'rotation') return round(((v as number) / RAD) % 360);
  if (key === 'opacity') return round((v as number) * 100);
  return typeof v === 'number' ? round(v) : v;
}

function round(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}

/** Field values for the given nodes, flagging disagreement as mixed. */
export function inspect(doc: SceneDocument, ids: readonly NodeId[]): InspectorField[] {
  const nodes = ids.filter((id) => doc.has(id)).map((id) => doc.get(id));
  if (nodes.length === 0) return [];
  const keys = [...NUMBER_KEYS, ...PAINT_KEYS];
  return keys.map((key) => {
    const targets = nodes.filter((n) => isEditable(n, key));
    const pool = targets.length > 0 ? targets : nodes;
    const first = display(key, pool[0] as SceneNode);
    const mixed = pool.some((n) => display(key, n) !== first);
    return {
      key,
      kind: PAINT_KEYS.includes(key) ? ('paint' as const) : ('number' as const),
      editable: targets.length > 0,
      value: mixed ? { mixed: true } : { mixed: false, value: first },
    };
  });
}

/** Parses user input for a field into a stored value, or `undefined` if invalid. */
export function parseField(key: FieldKey, input: string | number | null): unknown {
  if (key === 'fill' || key === 'stroke') {
    if (input === null) return null;
    const s = String(input).trim();
    if (s === '' || s.toLowerCase() === 'none') return null;
    return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : undefined;
  }
  const n = typeof input === 'number' ? input : Number(String(input).trim());
  if (input === '' || input === null || !Number.isFinite(n)) return undefined;
  switch (key) {
    case 'rotation':
      return n * RAD;
    case 'opacity':
      return Math.min(1, Math.max(0, n / 100));
    case 'width':
    case 'height':
      return Math.max(0, n);
    case 'strokeWidth':
      return Math.max(0, n);
    default:
      return n;
  }
}

/**
 * Applies an inspector edit to every selected node that supports the field, as
 * one undo step. Consecutive edits of the same field on the same selection
 * coalesce (typing or scrubbing a value). Returns false if nothing changed.
 */
export function applyField(
  doc: SceneDocument,
  history: History,
  ids: readonly NodeId[],
  key: FieldKey,
  input: string | number | null,
): boolean {
  const value = parseField(key, input);
  if (value === undefined) return false;
  const ops: Op[] = ids
    .filter((id) => doc.has(id) && isEditable(doc.get(id), key))
    .filter((id) => (doc.get(id) as unknown as Record<string, unknown>)[key] !== value)
    .map((id) => ({ kind: 'update', id, patch: { [key]: value } }) as Op);
  if (ops.length === 0) return false;
  history.apply(
    `Set ${key}`,
    ops.length === 1 ? (ops[0] as Op) : { kind: 'batch', ops },
    `inspect:${key}:${ids.join(',')}`,
  );
  return true;
}
