import { expect, test } from '@playwright/test';

type Hook = {
  doc: { root: { children: string[] }; size: number };
  history: { undo(): boolean; apply(l: string, op: unknown): void };
};

test('empty canvas shows onboarding; loading the sample is one undoable step', async ({ page }) => {
  await page.goto('/?collab=off');
  const card = page.getByRole('region', { name: 'Getting started' });
  await expect(card).toBeHidden();

  // Delete everything via history so the empty state appears.
  await page.evaluate(() => {
    const h = (window as unknown as { __frameloom: Hook }).__frameloom;
    for (const id of [...h.doc.root.children]) h.history.apply('Delete', { kind: 'remove', id });
  });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Load sample document' }).click();
  await expect(card).toBeHidden();
  const count = await page.evaluate(
    () => (window as unknown as { __frameloom: Hook }).__frameloom.doc.root.children.length,
  );
  expect(count).toBe(4);

  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(card).toBeVisible();
});

test('onboarding tool button activates the tool and hides nothing else', async ({ page }) => {
  await page.goto('/?collab=off');
  await page.evaluate(() => {
    const h = (window as unknown as { __frameloom: Hook }).__frameloom;
    for (const id of [...h.doc.root.children]) h.history.apply('Delete', { kind: 'remove', id });
  });
  await page
    .getByRole('button', { name: /Ellipse/ })
    .last()
    .click();
  await expect(page.locator('#tool-ellipse')).toHaveAttribute('aria-pressed', 'true');
});

test('mobile viewport keeps toolbar usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/?collab=off');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await expect(page.locator('#tool-rect')).toBeVisible();
});
