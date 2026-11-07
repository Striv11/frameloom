import { expect, test, type Page } from '@playwright/test';

interface Win {
  __frameloom: {
    doc: { find(id: string): { x: number } | undefined; size: number };
    history: { apply(label: string, op: unknown): void };
  };
  __frameloomCollab?: unknown;
}

const ready = (page: Page) =>
  page.waitForFunction(() => (window as unknown as Win).__frameloomCollab !== undefined);

test('two tabs see each other, and edits survive a reload', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/');
  await ready(a);
  await b.goto('/');
  await ready(b);

  const size = await a.evaluate(() => (window as unknown as Win).__frameloom.doc.size);
  expect(await b.evaluate(() => (window as unknown as Win).__frameloom.doc.size)).toBe(size);

  await a.evaluate(() => {
    const h = (window as unknown as Win).__frameloom;
    h.history.apply('add', {
      kind: 'add',
      nodes: [{ id: 'e2e-rect', type: 'rect', parentId: 'root', index: 0, x: 11 }],
    });
  });
  await expect
    .poll(() => b.evaluate(() => (window as unknown as Win).__frameloom.doc.find('e2e-rect')?.x))
    .toBe(11);

  await b.evaluate(() =>
    (window as unknown as Win).__frameloom.history.apply('move', {
      kind: 'update',
      id: 'e2e-rect',
      patch: { x: 42 },
    }),
  );
  await expect
    .poll(() => a.evaluate(() => (window as unknown as Win).__frameloom.doc.find('e2e-rect')?.x))
    .toBe(42);

  await a.close();
  await b.close();
  const c = await context.newPage();
  await c.goto('/');
  await ready(c);
  expect(
    await c.evaluate(() => (window as unknown as Win).__frameloom.doc.find('e2e-rect')?.x),
  ).toBe(42);
});
