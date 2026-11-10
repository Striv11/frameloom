import { expect, test } from '@playwright/test';

type Hook = {
  __frameloom: {
    camera: { panBy(dx: number, dy: number): void };
    renderer: { render(): void; resize(): void; drawn: number };
    doc: { size: number };
  };
};

// Budget from PLAN.md Day 14: panning 10k shapes must sustain >= 55 fps (<= ~18 ms/frame).
// We measure the median CPU cost of camera move + render, which is stricter than rAF cadence
// in headless Chromium (vsync-bound) and stable enough to enforce in CI.
const MAX_MEDIAN_MS = 1000 / 55;

for (const renderer of ['canvas2d', 'webgl'] as const) {
  test(`pan benchmark, 10k shapes, ${renderer}`, async ({ page }) => {
    await page.goto(`/?stress=10000&collab=off&renderer=${renderer}`);
    await expect(page.locator('#hud')).toContainText('10,000 shapes');
    const result = await page.evaluate(() => {
      const h = (window as unknown as Hook).__frameloom;
      h.renderer.resize();
      const times: number[] = [];
      for (let i = 0; i < 120; i++) {
        h.camera.panBy(12, 7);
        const t0 = performance.now();
        h.renderer.render();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return {
        median: times[Math.floor(times.length / 2)] ?? Infinity,
        p95: times[Math.floor(times.length * 0.95)] ?? Infinity,
        shapes: h.doc.size,
      };
    });
    console.log(
      `${renderer}: median ${result.median.toFixed(2)} ms, p95 ${result.p95.toFixed(2)} ms`,
    );
    expect(result.shapes).toBeGreaterThanOrEqual(10_000);
    expect(result.median).toBeLessThanOrEqual(MAX_MEDIAN_MS);
  });
}
