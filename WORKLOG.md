# Work log

Newest entries at the bottom. Each entry records what actually changed, what was learned, and what comes next.

## 2026-10-30 — Day 1

- Chose **Frameloom**, a collaborative vector design tool (TypeScript, browser, Pages), 14-day arc.
- Scaffolded Vite + strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) + Vitest + ESLint/Prettier + Playwright; `check.sh` runs format, tsc, eslint, vitest and a production build; CI has separate check and e2e jobs; `pages.yml` deploys `dist/`.
- Built the document model: affine matrices, scene graph with frames/groups, world matrices and bounds, paint-order traversal; 26 unit tests.
- Built a Canvas2D renderer with culling, a camera (cursor-anchored zoom, fit), pointer/pinch/wheel input, light/dark themes and a HUD; 2 Playwright flows pass locally.
- Learned: initialising theme before `invalidate` was declared hit a TDZ error that only showed up in the built bundle; the e2e test caught it.
- Next (Day 2): R-tree spatial index with property tests against brute force, then wire hit-testing into the viewer.

## 2026-10-31 — Day 2

- Wrote `src/spatial/rtree.ts`: R-tree with STR bulk loading, least-enlargement insert with axis splits, remove with condense/reinsert, update, rect search and point hit; `validate()` checks bounds, depth, parent links and the id→leaf map.
- Added `SceneIndex`: world-AABB index over a `SceneDocument` plus paint-order rank; `hitTest` returns the topmost visible/unlocked node, using the inverse world matrix so rotated boxes and ellipses are exact. Wired into the viewer as a hover name in the HUD.
- Tests: property tests vs. brute force on 10k shapes with 3000 random insert/remove/update steps (3 seeds), invariants, empty/duplicate cases, a hit-test median-time check (<0.1 ms), and scene-index tests for rotation, ellipses, locks, nesting and refresh. 40 tests total.
- Learned: touching-inclusive intersection must be used consistently in the tree and brute force, or edge cases diverge.
- Next (Day 3): selection and transform tools (click/shift/marquee, move/resize/rotate handles) built on `SceneIndex`. The index needs a cheaper incremental refresh once nodes move per frame.
