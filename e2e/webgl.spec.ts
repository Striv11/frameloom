import { expect, test } from '@playwright/test';

type Hook = { __frameloom: { rendererKind: string; renderer: { drawn: number } } };

test('?renderer=webgl renders the demo document (or falls back to Canvas2D)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?collab=off&renderer=webgl');
  await expect(page.locator('#hud')).toContainText('drawn');
  const info = await page.evaluate(() => {
    const h = (window as unknown as Hook).__frameloom;
    return { kind: h.rendererKind, drawn: h.renderer.drawn };
  });
  expect(info.drawn).toBeGreaterThan(0);
  expect(['webgl', 'canvas2d']).toContain(info.kind);
  if (info.kind === 'webgl') {
    // The WebGL layer must have painted something other than a flat background.
    const shot = await page.locator('#canvas').screenshot();
    const distinct = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4 * 97)
        seen.add(((d[i] as number) << 16) | ((d[i + 1] as number) << 8) | (d[i + 2] as number));
      return seen.size;
    }, shot.toString('base64'));
    expect(distinct).toBeGreaterThan(3);
    await expect(page.locator('.overlay-canvas')).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test('default renderer stays Canvas2D', async ({ page }) => {
  await page.goto('/?collab=off');
  const kind = await page.evaluate(() => (window as unknown as Hook).__frameloom.rendererKind);
  expect(kind).toBe('canvas2d');
});
