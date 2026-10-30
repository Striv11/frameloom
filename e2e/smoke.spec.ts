import { expect, test } from '@playwright/test';

interface Hook {
  __frameloom: { camera: { zoom: number; panX: number } };
}

test('renders the demo document and supports zoom and pan', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#canvas')).toBeVisible();
  await expect(page.locator('#hud')).toContainText('shapes');

  const zoom = () =>
    page.evaluate(() => (window as unknown as Hook).__frameloom.camera.zoom as number);
  const z0 = await zoom();
  await page.click('#zoom-in');
  expect(await zoom()).toBeGreaterThan(z0);

  const pan = () =>
    page.evaluate(() => (window as unknown as Hook).__frameloom.camera.panX as number);
  const p0 = await pan();
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 4 });
  await page.mouse.up();
  expect(await pan()).toBeCloseTo(p0 + 60, 0);
});

test('theme toggle persists', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => document.documentElement.dataset['theme']);
  await page.keyboard.press('d');
  const after = await page.evaluate(() => document.documentElement.dataset['theme']);
  expect(after).not.toBe(before);
});
