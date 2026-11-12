// Regenerates docs/screenshot-{light,dark}.png from a running preview server.
// Usage: npm run build && npx vite preview --port 4173 & PW_CHROMIUM=/usr/bin/chromium node scripts/screenshots.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM
    ? { executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'] }
    : {}),
});
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: scheme,
  });
  await page.goto(`${base}/?collab=off`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/screenshot-${scheme}.png` });
  await page.close();
}
await browser.close();
