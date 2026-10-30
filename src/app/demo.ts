import { SceneDocument } from '../model/document';

const PALETTE = ['#6c5ce7', '#00b894', '#fdcb6e', '#e17055', '#0984e3', '#e84393', '#2d3436'];

/** Small deterministic PRNG (mulberry32) so demo/stress documents are reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDemoDocument(): SceneDocument {
  const doc = new SceneDocument();

  const card = doc.add('frame', {
    name: 'Card',
    x: 80,
    y: 80,
    width: 360,
    height: 440,
    fill: '#ffffff',
    stroke: '#d0d3da',
    cornerRadius: 24,
  });
  doc.add('rect', { name: 'Cover', x: 0, y: 0, width: 360, height: 220, fill: '#6c5ce7' }, card.id);
  doc.add(
    'ellipse',
    { name: 'Sun', x: 230, y: 40, width: 90, height: 90, fill: '#fdcb6e' },
    card.id,
  );
  doc.add(
    'ellipse',
    { name: 'Hill', x: -60, y: 150, width: 300, height: 160, fill: '#00b894' },
    card.id,
  );
  doc.add(
    'text',
    { name: 'Title', x: 28, y: 252, text: 'Frameloom', fontSize: 32, height: 40, fill: '#1e1e2e' },
    card.id,
  );
  doc.add(
    'text',
    {
      name: 'Body',
      x: 28,
      y: 306,
      text: 'Design together, in your browser.',
      fontSize: 16,
      fill: '#5b6070',
    },
    card.id,
  );
  doc.add(
    'rect',
    { name: 'Button', x: 28, y: 360, width: 140, height: 44, cornerRadius: 22, fill: '#1e1e2e' },
    card.id,
  );

  const group = doc.add('group', { name: 'Badges', x: 520, y: 100, width: 320, height: 120 });
  PALETTE.slice(0, 4).forEach((fill, i) => {
    const box = { name: `Badge ${i + 1}`, x: i * 84, y: (i % 2) * 24, width: 72, height: 72, fill };
    if (i % 2) doc.add('ellipse', box, group.id);
    else doc.add('rect', { ...box, cornerRadius: 16 }, group.id);
  });

  doc.add('rect', {
    name: 'Tilted',
    x: 560,
    y: 280,
    width: 200,
    height: 120,
    rotation: Math.PI / 12,
    fill: '#e17055',
    cornerRadius: 12,
  });
  doc.add('line', {
    name: 'Rule',
    x: 520,
    y: 470,
    width: 320,
    height: -60,
    stroke: '#0984e3',
    strokeWidth: 4,
  });
  return doc;
}

/** A large grid-ish scatter of small shapes for performance work. */
export function createStressDocument(count: number, seed = 1): SceneDocument {
  const rand = prng(seed);
  const doc = new SceneDocument();
  const cols = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const w = 8 + rand() * 24;
    doc.add(rand() < 0.5 ? 'rect' : 'ellipse', {
      x: (i % cols) * 40 + rand() * 8,
      y: Math.floor(i / cols) * 40 + rand() * 8,
      width: w,
      height: 8 + rand() * 24,
      rotation: rand() < 0.3 ? rand() * Math.PI : 0,
      fill: PALETTE[Math.floor(rand() * PALETTE.length)] ?? '#999',
    });
  }
  return doc;
}
