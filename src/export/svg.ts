import type { SceneDocument } from '../model/document';
import { ROOT_ID } from '../model/document';
import { unionRect, type Matrix, type Rect } from '../model/matrix';
import { pathSegments } from '../model/path';
import type { NodeId, SceneNode } from '../model/types';

export interface SvgExportOptions {
  /** Export only these nodes (and their subtrees); default is the whole document. */
  ids?: readonly NodeId[];
  /** Extra space around the content, in px. */
  padding?: number;
  /** Optional solid background color. */
  background?: string | null;
}

export interface SvgExport {
  svg: string;
  width: number;
  height: number;
}

/** Deterministic number formatting: at most 3 decimals, no trailing zeros, no "-0". */
export function num(n: number): string {
  const s = (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const matrixAttr = (m: Matrix): string => `matrix(${m.map(num).join(' ')})`;

function roundedRect(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return rr > 0 ? ` rx="${num(rr)}"` : '';
}

/**
 * Serializes the document (or some nodes of it) as a standalone SVG string. Output is
 * deterministic (stable ids, rounded numbers) so it can be compared against a golden file.
 * Mirrors the Canvas2D renderer: hidden nodes are skipped, opacity multiplies down the tree,
 * clipping frames clip their children, lines and open paths are never filled.
 */
export function exportSvg(doc: SceneDocument, opts: SvgExportOptions = {}): SvgExport {
  const roots = pickRoots(doc, opts.ids);
  const pad = opts.padding ?? 0;

  let bounds: Rect | null = null;
  for (const id of roots) {
    const b = contentBounds(doc, id);
    if (b) bounds = unionRect(bounds, b);
  }
  const area: Rect = bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const x = area.x - pad;
  const y = area.y - pad;
  const width = Math.max(1, area.width + pad * 2);
  const height = Math.max(1, area.height + pad * 2);

  const defs: string[] = [];
  const out: string[] = [];
  let clipCount = 0;

  const emit = (id: NodeId, parentWorld: Matrix | null, depth: number): void => {
    const n = doc.get(id);
    if (!n.visible) return;
    const ind = '  '.repeat(depth);
    // Selected roots are placed by their full world matrix; descendants by their local one.
    const m = parentWorld === null ? doc.worldMatrix(id) : doc.localMatrix(id);
    const attrs = [`transform="${matrixAttr(m)}"`];
    if (n.opacity !== 1) attrs.push(`opacity="${num(n.opacity)}"`);
    attrs.push(`data-name="${escapeXml(n.name)}"`);
    out.push(`${ind}<g ${attrs.join(' ')}>`);
    const shape = shapeMarkup(n);
    if (shape) out.push(`${ind}  ${shape}`);
    let childDepth = depth + 1;
    const clips = n.type === 'frame' && n.clip && n.children.length > 0;
    if (clips) {
      clipCount += 1;
      const cid = `clip-${clipCount}`;
      const r = n.type === 'frame' ? n.cornerRadius : 0;
      defs.push(
        `    <clipPath id="${cid}"><rect width="${num(n.width)}" height="${num(n.height)}"${roundedRect(n.width, n.height, r)}/></clipPath>`,
      );
      out.push(`${ind}  <g clip-path="url(#${cid})">`);
      childDepth += 1;
    }
    for (const c of n.children) emit(c, m, childDepth);
    if (clips) out.push(`${ind}  </g>`);
    out.push(`${ind}</g>`);
  };
  for (const id of roots) emit(id, null, 1);

  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="${num(x)} ${num(y)} ${num(width)} ${num(height)}">`;
  const lines = [head];
  if (defs.length > 0) lines.push('  <defs>', ...defs, '  </defs>');
  if (opts.background)
    lines.push(
      `  <rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="${escapeXml(opts.background)}"/>`,
    );
  lines.push(...out, '</svg>', '');
  return { svg: lines.join('\n'), width, height };
}

/** Top-level export nodes in paint order; selected descendants of selected nodes are dropped. */
function pickRoots(doc: SceneDocument, ids: readonly NodeId[] | undefined): NodeId[] {
  if (!ids) return [...doc.root.children];
  const wanted = new Set(ids.filter((id) => id !== ROOT_ID && doc.has(id)));
  const roots: NodeId[] = [];
  const walk = (id: NodeId): void => {
    if (wanted.has(id)) {
      roots.push(id);
      return;
    }
    for (const c of doc.get(id).children) walk(c);
  };
  walk(ROOT_ID);
  return roots;
}

/** World bounds of a node's visible subtree (hidden nodes don't contribute). */
function contentBounds(doc: SceneDocument, id: NodeId): Rect | null {
  const n = doc.get(id);
  if (!n.visible) return null;
  let b: Rect | null = n.type === 'group' ? null : doc.worldBounds(id);
  // A clipping frame hides whatever sticks out, so its own box is the content.
  if (n.type === 'frame' && n.clip) return b;
  for (const c of n.children) {
    const cb = contentBounds(doc, c);
    if (cb) b = unionRect(b, cb);
  }
  return b;
}

function paintAttrs(n: SceneNode, fillable: boolean): string {
  const fill = fillable && n.fill ? escapeXml(n.fill) : 'none';
  let s = `fill="${fill}"`;
  if (n.stroke && n.strokeWidth > 0)
    s += ` stroke="${escapeXml(n.stroke)}" stroke-width="${num(n.strokeWidth)}" stroke-linecap="round"`;
  return s;
}

function shapeMarkup(n: SceneNode): string {
  switch (n.type) {
    case 'frame':
    case 'rect':
      return `<rect width="${num(n.width)}" height="${num(n.height)}"${roundedRect(n.width, n.height, n.cornerRadius)} ${paintAttrs(n, true)}/>`;
    case 'ellipse':
      return `<ellipse cx="${num(n.width / 2)}" cy="${num(n.height / 2)}" rx="${num(n.width / 2)}" ry="${num(n.height / 2)}" ${paintAttrs(n, true)}/>`;
    case 'line':
      return `<line x1="0" y1="0" x2="${num(n.width)}" y2="${num(n.height)}" ${paintAttrs(n, false)}/>`;
    case 'path': {
      const segs = pathSegments(n.anchors, n.closed);
      if (segs.length === 0) return '';
      let d = '';
      for (const [i, s] of segs.entries()) {
        if (i === 0) d += `M${num(s[0].x)} ${num(s[0].y)}`;
        d += `C${num(s[1].x)} ${num(s[1].y)} ${num(s[2].x)} ${num(s[2].y)} ${num(s[3].x)} ${num(s[3].y)}`;
      }
      if (n.closed) d += 'Z';
      return `<path d="${d}" ${paintAttrs(n, n.closed)}/>`;
    }
    case 'text': {
      if (!n.fill) return '';
      return `<text font-family="${escapeXml(n.fontFamily)}" font-size="${num(n.fontSize)}" dominant-baseline="text-before-edge" fill="${escapeXml(n.fill)}" xml:space="preserve">${escapeXml(n.text)}</text>`;
    }
    case 'group':
      return '';
  }
}

/**
 * Rasterizes an SVG string to a PNG blob at `scale`x. Browser-only: uses an <img> and a canvas.
 * The SVG is loaded from a `data:` URL, so nothing leaves the page.
 */
export async function svgToPng(svg: SvgExport, scale = 2): Promise<Blob> {
  const img = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.svg)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not rasterize the SVG'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(svg.width * scale));
  canvas.height = Math.max(1, Math.round(svg.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}
