import { expect, test, type Page } from '@playwright/test';

interface N {
  id: string;
  name: string;
  fill: string | null;
  component?: boolean;
  instanceOf?: string;
  sourceId?: string;
  children: string[];
}
interface Win {
  __frameloom: {
    doc: { paintOrder(): Iterable<N>; find(id: string): N | undefined };
    history: { apply(label: string, op: unknown): void };
    tool: { selection: { replace(ids: string[]): void } };
  };
  __frameloomCollab?: unknown;
}

const ready = (page: Page) =>
  page.waitForFunction(() => (window as unknown as Win).__frameloomCollab !== undefined);

test('make component, instantiate, propagate master edits, sync to a second tab', async ({
  context,
}) => {
  const a = await context.newPage();
  await a.goto('/');
  await ready(a);
  const b = await context.newPage();
  await b.goto('/');
  await ready(b);

  // Pick a frame with at least one child from the demo document.
  const masterId = await a.evaluate(() => {
    const h = (window as unknown as Win).__frameloom;
    for (const n of h.doc.paintOrder()) if (n.name === 'Card') return n.id;
    throw new Error('no Card');
  });
  await a.evaluate(
    (id) => (window as unknown as Win).__frameloom.tool.selection.replace([id]),
    masterId,
  );
  await a.keyboard.press('Control+Alt+k');
  await a.keyboard.press('Control+Alt+i');

  const instance = () =>
    a.evaluate((mid) => {
      const h = (window as unknown as Win).__frameloom;
      for (const n of h.doc.paintOrder()) {
        if (n.instanceOf === mid) {
          const kids = n.children.map((c) => h.doc.find(c)!);
          return { id: n.id, kids: kids.map((k) => ({ source: k.sourceId, fill: k.fill })) };
        }
      }
      return null;
    }, masterId);
  const inst = await instance();
  expect(inst).not.toBeNull();
  expect(inst!.kids.length).toBeGreaterThan(0);

  // Editing a master child recolors the instance's mirror.
  const target = inst!.kids[0]!;
  await a.evaluate(
    ([sid]) =>
      (window as unknown as Win).__frameloom.history.apply('recolor', {
        kind: 'update',
        id: sid,
        patch: { fill: '#abcdef' },
      }),
    [target.source],
  );
  await expect.poll(async () => (await instance())!.kids[0]!.fill).toBe('#abcdef');

  // The other tab receives the instance and the propagated color.
  await expect
    .poll(() =>
      b.evaluate((mid) => {
        const h = (window as unknown as Win).__frameloom;
        for (const n of h.doc.paintOrder()) {
          if (n.instanceOf === mid) return h.doc.find(n.children[0]!)?.fill;
        }
        return null;
      }, masterId),
    )
    .toBe('#abcdef');
});
