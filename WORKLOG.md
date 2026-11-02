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

## 2026-11-01 — Day 5 (operation log, undo/redo)

- Added `src/model/history.ts`: `Op` = add (subtree snapshot) / remove / update / reparent / batch. `applyOp` returns the exact inverse of whatever it ran (update captures old values of touched keys only; remove snapshots the subtree with sibling indexes), so undo is generic. `History` has undo/redo stacks, a size limit and key-based coalescing that is sealed by any undo/redo.
- Tools keep mutating live for responsiveness; on pointer-up `SelectTool` records one batch of before/after patches (nothing if nothing changed, so clicks, marquees and cancelled drags leave no history) and `CreateTool` records an add/remove pair. Wired Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y and undo/redo toolbar buttons; after a step the index is rebuilt and the selection pruned.
- Tests: 13 new unit tests incl. a property test (5 seeds × 300 random add/update/remove/reparent ops with interleaved undo/redo: undo-all equals the original, redo-all equals the final state) and one Playwright flow. 98 unit tests, 6 e2e.
- Learned: recording the pre/post patches at gesture end is simpler and cheaper than routing every mid-drag update through history; the live path stays untouched.
- Limits: redo of coalesced batches grows with repeated keyed entries (no keyed callers yet; keyboard nudges will use it); the index is still rebuilt wholesale after undo.
- Next (Day 6): pen tool and bezier path node (cubic segments, exact bounds, hit-testing).

## 2026-11-02 — Day 6 (pen tool, bezier paths)

- Added the `path` node and `src/model/path.ts`: cubic segments from anchors with in/out handles, exact bounds via derivative roots, adaptive flattening (de Casteljau), distance-to-curve, non-zero winding fill test, and `normalizePath`, which keeps anchors relative to the curve's own bounds so `x/y/width/height` stay meaningful and the existing selection/move/rotate/R-tree code needed no changes.
- `PenTool` (DOM-free): click = corner, drag = symmetric handle (drags under 3px count as clicks), click the first anchor to close, Enter/Esc/tool switch commits an open path as one undo step. Wired in with a `P` shortcut, toolbar button, and an overlay drawing anchors/handles while drawing. Renderer draws paths with `bezierCurveTo`; `SceneIndex.hitTest` uses stroke distance for open paths and winding for filled closed ones.
- Tests: 23 new unit tests (random-cubic bounds vs. dense sampling, flattening within tolerance, split consistency, hit/containment, pen sessions incl. frames, close, cancel, undo/redo). 121 unit tests pass via `check.sh`.
- Not verified: the new Playwright flow (pen draws a curve, Enter commits, undo removes it) is written but Chromium isn't installed in this environment, so it has not been run; the existing e2e flows couldn't run either.
- Learned: `-outX` on a zero gives `-0`, which `toMatchObject` (Object.is) rejects; normalise it at the source.
- Limits: no editing of existing paths yet (anchor/handle dragging after commit), no resize by handle for paths, R-tree bounds ignore stroke width so very thick strokes at extremes can be missed by hit-testing.
- Next (Day 7): text node with edit-in-place, layers panel, inspector. Path anchor editing is a good candidate to slot in alongside the inspector.
