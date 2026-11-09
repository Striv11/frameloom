import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { escapeXml, exportSvg, num } from '../src/export/svg';
import { SceneDocument } from '../src/model/document';
import { anchor } from '../src/model/path';
import { fuzzyFilter, fuzzyMatch } from '../src/ui/fuzzy';

function sample(): SceneDocument {
  const doc = new SceneDocument();
  const frame = doc.add('frame', {
    id: 'f1',
    name: 'Card',
    x: 20,
    y: 10,
    width: 200,
    height: 120,
    fill: '#ffffff',
    stroke: '#cccccc',
    strokeWidth: 1,
    cornerRadius: 12,
    clip: true,
  });
  doc.add(
    'rect',
    { id: 'r1', name: 'Button', x: 16, y: 70, width: 80, height: 32, fill: '#5b4bd6', cornerRadius: 6 },
    frame.id,
  );
  doc.add(
    'ellipse',
    { id: 'e1', name: 'Dot', x: 150, y: 20, width: 30, height: 30, fill: '#e17055', opacity: 0.5 },
    frame.id,
  );
  doc.add(
    'text',
    { id: 't1', name: 'Title', x: 16, y: 16, text: 'Tom & "Jerry" <3', fontSize: 18, fill: '#111111' },
    frame.id,
  );
  doc.add(
    'path',
    {
      id: 'p1',
      name: 'Wave',
      x: 240,
      y: 30,
      width: 60,
      height: 30,
      rotation: Math.PI / 6,
      fill: '#00b894',
      stroke: '#006d5b',
      strokeWidth: 2,
      anchors: [anchor(0, 0, 20, 0), anchor(60, 30, -20, 0)],
      closed: false,
    },
  );
  doc.add('line', { id: 'l1', name: 'Rule', x: 20, y: 150, width: 200, height: 0, stroke: '#333333', strokeWidth: 2 });
  doc.add('rect', { id: 'h1', name: 'Hidden', x: 500, y: 500, width: 50, height: 50, visible: false });
  return doc;
}

describe('svg export', () => {
  it('formats numbers deterministically', () => {
    expect(num(1.23456)).toBe('1.235');
    expect(num(2)).toBe('2');
    expect(num(-0.0001)).toBe('0');
    expect(num(10)).toBe('10');
    expect(num(0.5)).toBe('0.5');
  });

  it('escapes XML', () => {
    expect(escapeXml(`a&b<c>"d"`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
  });

  it('matches the golden file', () => {
    const { svg } = exportSvg(sample(), { padding: 8, background: '#f1f2f4' });
    const golden = new URL('./golden/sample.svg', import.meta.url);
    if (process.env['UPDATE_GOLDEN']) writeFileSync(golden, svg);
    expect(svg).toBe(readFileSync(golden, 'utf8'));
  });

  it('is deterministic and skips hidden nodes', () => {
    const a = exportSvg(sample()).svg;
    expect(exportSvg(sample()).svg).toBe(a);
    expect(a).not.toContain('Hidden');
  });

  it('sizes the canvas to visible content, honoring clipping and padding', () => {
    const doc = sample();
    const r = exportSvg(doc, { ids: ['f1'], padding: 4 });
    expect(r.width).toBe(208);
    expect(r.height).toBe(128);
    expect(r.svg).toContain('viewBox="16 6 208 128"');
    expect(r.svg).toContain('<clipPath id="clip-1">');
  });

  it('exports only selected nodes, placed by world transform', () => {
    const doc = sample();
    const r = exportSvg(doc, { ids: ['r1', 'f1', 'nope', 'root'] });
    // r1 is inside f1, so only the frame is a root: the rect appears once.
    expect(r.svg.match(/data-name="Button"/g)).toHaveLength(1);
    const only = exportSvg(doc, { ids: ['r1'] });
    expect(only.svg).toContain('matrix(1 0 0 1 36 80)');
    expect(only.width).toBe(80);
    expect(only.svg).not.toContain('Card');
  });

  it('does not fill lines or open paths', () => {
    const { svg } = exportSvg(sample());
    expect(svg).toMatch(/<line [^>]*fill="none"/);
    expect(svg).toMatch(/<path d="M0 0C20 0 80 30 60 30" fill="none"/);
  });

  it('returns a valid empty canvas for an empty document', () => {
    const r = exportSvg(new SceneDocument());
    expect(r.svg).toContain('<svg');
    expect(r.width).toBe(1);
  });
});

describe('fuzzy matching', () => {
  it('requires a subsequence, case-insensitively', () => {
    expect(fuzzyMatch('zx', 'Zoom to fit')).toBeNull();
    expect(fuzzyMatch('ZTF', 'Zoom to fit')?.positions).toEqual([0, 5, 8]);
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch('toolong', 'to')).toBeNull();
  });

  it('prefers word starts and consecutive runs', () => {
    const items = ['Align left', 'Toggle theme', 'Export PNG', 'Export SVG'];
    expect(fuzzyFilter('exp', items, (s) => s).map((r) => r.item)).toEqual([
      'Export PNG',
      'Export SVG',
    ]);
    expect(fuzzyFilter('tt', items, (s) => s)[0]?.item).toBe('Toggle theme');
    // Word-start acronym beats a scattered match.
    const r = fuzzyFilter('es', ['Reset overrides', 'Export SVG'], (s) => s);
    expect(r[0]?.item).toBe('Export SVG');
  });

  it('is stable for equal scores', () => {
    const r = fuzzyFilter('a', ['a1', 'a2', 'a3'], (s) => s);
    expect(r.map((x) => x.item)).toEqual(['a1', 'a2', 'a3']);
  });
});
