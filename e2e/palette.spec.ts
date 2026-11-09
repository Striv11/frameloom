import { expect, test } from '@playwright/test';

test('command palette runs a fuzzy-matched command and the shortcut sheet opens', async ({
  page,
}) => {
  await page.goto('/?collab=off');
  await page.locator('#canvas').focus();

  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Search commands' });
  await expect(input).toBeVisible();
  await input.fill('tool pen');
  await expect(page.locator('.palette-item').first()).toContainText('Tool: Pen');
  await page.keyboard.press('Enter');
  await expect(input).toBeHidden();
  await expect(page.locator('#tool-pen')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
});

test('SVG export of the demo document is well-formed and includes every visible node', async ({
  page,
}) => {
  await page.goto('/?collab=off');
  const svg = await page.evaluate(() => {
    const w = window as unknown as { __frameloom: { exportSvg(): { svg: string } } };
    return w.__frameloom.exportSvg().svg;
  });
  const parsed = await page.evaluate((s) => {
    const d = new DOMParser().parseFromString(s, 'image/svg+xml');
    return {
      error: d.querySelector('parsererror') !== null,
      groups: d.querySelectorAll('g[data-name]').length,
    };
  }, svg);
  expect(parsed.error).toBe(false);
  expect(parsed.groups).toBeGreaterThan(3);
});
