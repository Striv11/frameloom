import { expect, test, type Page } from '@playwright/test';

interface Hook {
  __frameloom: {
    camera: {
      zoom: number;
      panX: number;
      worldToScreen(p: { x: number; y: number }): { x: number; y: number };
    };
    doc: {
      paintOrder(): Iterable<{
        id: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
      }>;
    };
    tool: { selection: { ids: string[] } };
  };
}

async function node(page: Page, name: string) {
  return page.evaluate((n) => {
    const h = (window as unknown as Hook).__frameloom;
    for (const x of h.doc.paintOrder()) if (x.name === n) return { ...x };
    throw new Error(`no node ${n}`);
  }, name);
}

/** Screen position (page coordinates) of a world point. */
async function screenOf(page: Page, wx: number, wy: number) {
  const s = await page.evaluate(
    ([x, y]) => (window as unknown as Hook).__frameloom.camera.worldToScreen({ x: x!, y: y! }),
    [wx, wy],
  );
  const box = (await page.locator('#canvas').boundingBox())!;
  return { x: box.x + s.x, y: box.y + s.y };
}

const selected = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__frameloom.tool.selection.ids.length);

test('renders the demo document and supports zoom and space-drag pan', async ({ page }) => {
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
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 230, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await pan()).toBeCloseTo(p0 + 60, 0);
  expect(await selected(page)).toBe(0);
});

test('click selects, drag moves, shift adds, escape clears', async ({ page }) => {
  await page.goto('/');
  const cover = await node(page, 'Cover');
  // Cover is a child of the Card frame at (80, 80), so its world origin is (80, 80).
  const p = await screenOf(page, 80 + 40, 80 + 40);
  await page.mouse.click(p.x, p.y);
  expect(await selected(page)).toBe(1);
  await expect(page.locator('#hud')).toContainText('1 selected');

  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 20, { steps: 5 });
  await page.mouse.up();
  const moved = await node(page, 'Cover');
  const zoom = await page.evaluate(() => (window as unknown as Hook).__frameloom.camera.zoom);
  expect(moved.x).toBeCloseTo(cover.x + 40 / zoom, 1);
  expect(moved.y).toBeCloseTo(cover.y + 20 / zoom, 1);

  const other = await screenOf(page, 560 + 100, 280 + 60); // inside "Tilted"
  await page.keyboard.down('Shift');
  await page.mouse.click(other.x, other.y);
  await page.keyboard.up('Shift');
  expect(await selected(page)).toBe(2);

  await page.keyboard.press('Escape');
  expect(await selected(page)).toBe(0);
});

test('marquee selects shapes and the south-east handle resizes', async ({ page }) => {
  await page.goto('/');
  const from = await screenOf(page, 500, 80);
  const to = await screenOf(page, 880, 240);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  expect(await selected(page)).toBe(1); // the Badges group resolves to one node

  await page.keyboard.press('Escape');
  const tilted = await screenOf(page, 560 + 100, 280 + 60);
  await page.mouse.click(tilted.x, tilted.y);
  expect(await selected(page)).toBe(1);
  const before = await node(page, 'Tilted');
  // Drag the south-east corner outward along the box's own axes.
  const c = Math.cos(before.rotation);
  const s = Math.sin(before.rotation);
  const se = await screenOf(
    page,
    before.x + before.width * c - before.height * s,
    before.y + before.width * s + before.height * c,
  );
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  await page.mouse.move(se.x + 30, se.y + 30, { steps: 5 });
  await page.mouse.up();
  const after = await node(page, 'Tilted');
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.rotation).toBeCloseTo(before.rotation, 9);
});

test('theme toggle persists', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => document.documentElement.dataset['theme']);
  await page.keyboard.press('d');
  const after = await page.evaluate(() => document.documentElement.dataset['theme']);
  expect(after).not.toBe(before);
});

test('creation tools draw rect, ellipse and line, constrain with Shift, cancel with Escape', async ({
  page,
}) => {
  await page.goto('/');
  const count = () =>
    page.evaluate(() => {
      return [...(window as unknown as Hook).__frameloom.doc.paintOrder()].length;
    });
  const last = () =>
    page.evaluate(() => {
      let l: unknown;
      for (const x of (window as unknown as Hook).__frameloom.doc.paintOrder()) l = x;
      return { ...(l as Record<string, unknown>) } as {
        type: string;
        width: number;
        height: number;
      };
    });
  const before = await count();
  // Empty canvas area in world space, left of the demo content.
  const a = await screenOf(page, 450, 250);
  const b = await screenOf(page, 540, 300);

  await page.keyboard.press('r');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect(await count()).toBe(before + 1);
  const rect = await last();
  expect(rect.type).toBe('rect');
  expect(rect.width).toBeCloseTo(90, 0);
  expect(rect.height).toBeCloseTo(50, 0);
  expect(await selected(page)).toBe(1);

  await page.keyboard.press('o');
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y + 60);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + 60, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const ell = await last();
  expect(ell.type).toBe('ellipse');
  expect(ell.width).toBeCloseTo(ell.height, 3);

  await page.keyboard.press('l');
  await page.mouse.move(a.x, a.y + 120);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y + 120, { steps: 4 });
  await page.mouse.up();
  expect((await last()).type).toBe('line');
  expect(await count()).toBe(before + 3);

  await page.keyboard.press('r');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await count()).toBe(before + 3);
});

test('undo/redo reverts a drawn shape and a move via keyboard and buttons', async ({ page }) => {
  await page.goto('/');
  const count = () =>
    page.evaluate(() => [...(window as unknown as Hook).__frameloom.doc.paintOrder()].length);
  const before = await count();
  await expect(page.locator('#undo')).toBeDisabled();
  const a = await screenOf(page, 450, 250);
  const b = await screenOf(page, 540, 300);

  await page.keyboard.press('r');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect(await count()).toBe(before + 1);
  await expect(page.locator('#undo')).toBeEnabled();

  // Move the new (selected) shape.
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 40, mid.y + 30, { steps: 5 });
  await page.mouse.up();

  await page.keyboard.press('Control+z'); // undo move
  expect(await count()).toBe(before + 1);
  await page.keyboard.press('Control+z'); // undo create
  expect(await count()).toBe(before);
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await selected(page)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  expect(await count()).toBe(before + 1);
  await page.locator('#redo').click();
  await expect(page.locator('#redo')).toBeDisabled();
});

test('pen tool draws a curved path, Enter commits it, undo removes it', async ({ page }) => {
  await page.goto('/');
  const paths = () =>
    page.evaluate(() => {
      const h = (window as unknown as Hook).__frameloom;
      return [...h.doc.paintOrder()]
        .filter((n) => (n as { type?: string }).type === 'path')
        .map((n) => ({ ...n, anchors: (n as unknown as { anchors: unknown[] }).anchors }));
    });
  const a = await screenOf(page, 450, 250);
  const b = await screenOf(page, 560, 250);
  const c = await screenOf(page, 560, 340);

  await page.keyboard.press('p');
  await expect(page.locator('#tool-pen')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(a.x, a.y);
  // Drag the second anchor to pull out a bezier handle.
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Enter');

  const [p] = await paths();
  expect(p?.anchors).toHaveLength(3);
  expect(p!.width).toBeGreaterThan(100);
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
  expect(await selected(page)).toBe(1);

  await page.keyboard.press('Control+z');
  expect(await paths()).toHaveLength(0);
});

test('text tool creates text in place and the inspector edits it', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('t');
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 200);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Control+Enter');
  const count = await page.evaluate(
    () =>
      [...(window as unknown as Hook).__frameloom.doc.paintOrder()].filter(
        (n) => (n as { type?: string }).type === 'text',
      ).length,
  );
  expect(count).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#inspector')).toBeVisible();
  await page.locator('#inspector [data-field="x"]').fill('123');
  await page.locator('#inspector [data-field="x"]').press('Enter');
  await expect(page.locator('#inspector [data-field="x"]')).toHaveValue('123');
});
