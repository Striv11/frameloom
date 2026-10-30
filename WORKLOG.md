# Work log

Newest entries at the bottom. Each entry records what actually changed, what was learned, and what comes next.

## 2026-10-30 — Day 1

- Chose **Frameloom**, a collaborative vector design tool (TypeScript, browser, Pages), 14-day arc.
- Scaffolded Vite + strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) + Vitest + ESLint/Prettier + Playwright; `check.sh` runs format, tsc, eslint, vitest and a production build; CI has separate check and e2e jobs; `pages.yml` deploys `dist/`.
- Built the document model: affine matrices, scene graph with frames/groups, world matrices and bounds, paint-order traversal; 26 unit tests.
- Built a Canvas2D renderer with culling, a camera (cursor-anchored zoom, fit), pointer/pinch/wheel input, light/dark themes and a HUD; 2 Playwright flows pass locally.
- Learned: initialising theme before `invalidate` was declared hit a TDZ error that only showed up in the built bundle; the e2e test caught it.
- Next (Day 2): R-tree spatial index with property tests against brute force, then wire hit-testing into the viewer.
