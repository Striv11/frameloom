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

## 2026-10-31 — Day 3 (selection and transform)

- Added `src/tools/`: pure transform math (`movePatch`, `resizePatch`, `rotatePatch`), `Selection` + group-aware picking + marquee, selection frame/handles, and `SelectTool`, a DOM-free pointer state machine (click, shift-click, marquee, move, 8 resize handles, rotate handle, Esc to cancel). `src/render/overlay.ts` paints outlines, handles and the marquee through a new renderer `overlay` hook.
- Pan moved to Space+drag / middle-drag because the primary drag now selects; two-finger pinch still pans and zooms (and cancels any tool drag).
- Key idea: resize maps the pointer into the node's _starting local frame_, so no per-rotation special cases are needed — the opposite corner stays fixed under any node or parent rotation. Rotation keeps the center fixed and snaps the _absolute_ rotation.
- Tests: 31 new unit tests (property test over 400 random rotated nodes/parents for resize invariants, rotation about center against the document world matrix, move under a rotated parent, group/frame picking, marquee rules, handle placement) and 2 new Playwright flows (select/move/shift/escape; marquee + resize of the rotated shape). 71 unit tests total.
- Learned: the pointer event delta must be taken from drag-start snapshots, not accumulated, or cancel and rotated-parent moves drift.
- Limits, on purpose: handle-resize is single-node only; lines/groups don't resize (needs endpoint editing / child scaling); no snapping yet (Day 9).
- Next (Day 4): shape creation tools (R/O/L/V shortcuts, drag-to-create, Shift constrain) reusing `SelectTool`'s drag machinery; e2e asserts document state.

## 2026-11-01 — Day 4 (shape creation tools)

- Added `src/tools/create-tool.ts`: `CreateTool` (DOM-free) creates a rect, ellipse or line live while dragging, and `shapeBox` does the pure geometry (normalised boxes, Shift = square or 45° line snap, lines keep signed width/height). Clicks without a real drag create nothing; Esc removes the in-progress shape.
- New shapes are parented to the topmost visible, unlocked, un-rotated frame under the pointer (start point converted into the frame's local space), else the root. Rotated frames are skipped on purpose: with no scale in the model, parenting there would need a compensating rotation, which can come with reparenting on Day 8.
- Wired into the viewer: toolbar buttons with `aria-pressed`, V/R/O/L shortcuts, crosshair cursor, Esc returns to Select, pinch cancels a creation drag. After creating, the shape is selected and the tool reverts to Select.
- Tests: 14 new unit tests (geometry, parenting under nested frames, rotated-frame fallback, zoom/pan, live display, cancel, index consistency) and a Playwright flow drawing all three shapes plus Shift and Escape. 85 unit tests, 5 e2e pass.
- Learned: `doc.size` excludes the root; the index is rebuilt on create/discard because it has no incremental add/remove yet — fine for single shapes, to be revisited with undo ops on Day 5.
- Next (Day 5): operation log with invertible ops and undo/redo (creation and transforms become ops, drags coalesce).
