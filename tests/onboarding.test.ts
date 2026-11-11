import { describe, expect, it } from 'vitest';
import { sampleOp } from '../src/app/demo';
import { SceneDocument } from '../src/model/document';
import { History } from '../src/model/history';
import { isDocumentEmpty } from '../src/ui/onboarding';

describe('onboarding helpers', () => {
  it('detects an empty document', () => {
    const doc = new SceneDocument();
    expect(isDocumentEmpty(doc)).toBe(true);
    doc.add('rect');
    expect(isDocumentEmpty(doc)).toBe(false);
  });

  it('loads the sample as one undo step, repeatedly without id collisions', () => {
    const doc = new SceneDocument();
    const history = new History(doc);
    history.apply('Load sample', sampleOp(doc, 's1'));
    const first = doc.size;
    expect(first).toBeGreaterThan(10);
    history.apply('Load sample', sampleOp(doc, 's2'));
    expect(doc.size).toBe(first * 2);
    history.undo();
    expect(doc.size).toBe(first);
    history.undo();
    expect(isDocumentEmpty(doc)).toBe(true);
    history.redo();
    expect(doc.size).toBe(first);
  });
});
