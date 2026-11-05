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

## 2026-11-03 — Day 7, part 1 (text, inspector)

- Added `TextTool` (DOM-free): click creates a text node, `edit(id)` reopens one, content re-measures through an injected `TextMeasure` (canvas `measureText` in the app, a deterministic approximation in tests). Create and edit are each one undo step, and the edit's undo restores text and box together. Empty new text vanishes without touching history.
- Added `src/tools/inspector.ts`: display-unit values with `mixed` detection, input validation (hex colors / none, opacity clamp, degrees to radians), and `applyField`, which edits all selected nodes that support the field as one batch and coalesces repeated edits of the same field. Size is read-only for text, lines, paths and groups, since there is no resize op for them yet.
- UI: `T` tool and toolbar button, textarea overlay positioned from the camera, double-click to edit text, an inspector panel that updates in place (no rebuild while typing).
- Tests: 15 new unit tests (136 total) plus an e2e flow for text and inspector. **The e2e flow is unverified**: Chromium is not installed here, so no Playwright test (new or old) has run.
- Learned: a text undo needs the measured size in the patch, otherwise undoing a longer edit leaves a stale box.
- Not done: **layers panel** (rename, visibility/lock, drag reorder) — the rest of Day 7, so the PLAN row is marked partial (`[~]`). Inspector stroke/fill use text inputs, no color picker.
- Next: layers panel on top of `History` reparent/update ops, then finish Day 7 and move to grouping (Day 8).

## 2026-11-03 — Day 7, part 2 (layers panel)

- Added `src/tools/layers.ts` (pure, DOM-free): `layerRows` (topmost-first tree, collapsible, row limit), `renameLayer`, `setLayerVisible`, `setLayerLocked`, `moveLayer`. Every mutation goes through `History`, so each is one undo step and no-ops (same name, same position, blank name) leave no history.
- `moveLayer` handles above/below/inside drops. Moving between parents shifts x/y so the world position is unchanged; if either parent chain is rotated it refuses (a compensating rotation needs the general reparent work planned for Day 8). Cycles, non-container targets and the root are rejected.
- UI: left-hand layers panel with select/shift-select, double-click rename, visibility and lock toggles (the renderer and hit-test already honored those flags), twisty collapse, and HTML drag-and-drop with drop-position markers. The DOM is rebuilt only when a cheap signature of the first 300 rows changes, so the 10k stress scene stays fast. Hidden below 640px wide.
- Tests: 10 new unit tests (146 total) covering rows, caps, rename/visibility/lock undo, reorder in both directions, world-preserving reparent in and out of frames, and rejection cases. A Playwright flow for the panel was added but **not run**: Chromium isn't installed here (same as Days 6–7 part 1), so no e2e has been verified recently.
- Learned: `reparent`'s index is counted after detaching, so "drop below" in the same parent needs the sibling list filtered of the dragged node first.
- Limits: no keyboard reordering in the panel, native drag-and-drop isn't touch-friendly, names/ids of descendants of a hidden parent aren't dimmed.
- Day 7 is complete. Next (Day 8): multi-select, Ctrl+G group/ungroup, frame clipping, drop-to-reparent on the canvas (reuse `moveLayer`'s world-preserving logic, extended to rotated parents), mixed-value inspector is already done.

## 2026-11-04 — Day 8, part 1 (grouping, world-preserving reparent)

- Added `src/tools/grouping.ts`. `placementIn`/`keepWorldPatch` solve "same world transform under another parent" as `inverse(parentWorld) · world`, decomposed into x/y/rotation; this is exact because nodes never scale or skew. `moveLayer` now uses it, which removes the old restriction that refused moves into or out of rotated parents.
- `groupNodes` (Ctrl/⌘+G) wraps top-level selected nodes in a group sized to their bounds in the parent's space, placed at the topmost member's stacking position, members keeping relative order. `ungroupNodes` (Ctrl/⌘+Shift+G) frees children in place; nested selected groups stay intact inside an outer one. Both are a single undo batch.
- Tests: 10 new unit tests (grouping, ungrouping, rotated frames, undo/redo) and the layers test for rotated parents was changed from "rejects" to "preserves world transform" because that behavior was intentionally replaced. All 156 unit tests pass in `check.sh`. No e2e written or run (Chromium still not installed here).
- Learned: when inserting the group before lifting members out, the insert index must be computed against the original child list (top member index + 1), not the filtered one.
- Day 8 stays `[~]`: still to do is drop-to-reparent when dragging on the canvas (drop a moved shape into a frame, using `keepWorldPatch`), plus an e2e for Ctrl+G.
- Next: canvas drop-to-reparent, then Day 9 snapping.

## 2026-11-04 — Day 8, part 2 (drop-to-reparent)

- `SelectTool` now reparents on move release: the target is the topmost visible, unlocked frame under the pointer that is not part of the moved selection, else the root. Uses `keepWorldPatch`, so world transforms survive rotated frames. Only nodes directly under the root or a frame move between containers (group members stay); a click without movement never reparents.
- The reparent is folded into the same history record as the move (redo: reparent + final placement; undo: restore placement + original parent and index), so it is one undo step.
- Tests: 4 new (drop into frame with undo/redo, rotated frame, drop out to canvas, no reparent on click or when moving a frame). 160 unit tests pass. Still no e2e run (no Chromium here); no e2e for Ctrl+G or drop was written.
- Learned: the tool only commits when a `History` is injected, so tests of committed behavior must pass one.
- Day 8 done. Next: Day 9 snapping and alignment guides (snap solver, 8px screen threshold, align/distribute).

## 2026-11-05 — Day 9 (snapping, alignment)

- Added `src/tools/snap.ts` (pure): `solveSnap` snaps a moving rect per axis to sibling/frame edges and centers and to equal spacing (after, before, centered between a pair), threshold `8px / zoom`, and returns guides for everything that lines up exactly at the snapped position.
- `SelectTool` snaps moves using the start-of-drag union bounds plus the raw pointer delta (so snap never feeds back on itself), considers only the 24 nearest visible siblings found through the R-tree plus the parent frame, exposes `guides`, and Alt bypasses. The overlay draws dashed alignment lines and solid spacing ones.
- Added `src/tools/align.ts`: align (to selection bounds; a lone child aligns to its frame) and distribute (equal gaps), each one undo step and correct under rotated parents; Alt+A/D/W/S/H/V and Alt+Shift+H/V shortcuts.
- Tests: 13 new (solver, tool integration incl. zoom-independent threshold, Alt bypass, undo, align/distribute). 173 unit tests pass. The drop-to-reparent tests now set `snapEnabled = false`, since they assert raw drag geometry. No e2e run (no Chromium here); the keyboard shortcuts and guide rendering are therefore unverified in a browser.
- Learned: snap against the raw (unsnapped) delta each move, not the live node position, otherwise the shape sticks.
- Limits: snapping applies to moves only (not resize/rotate), siblings only, no toolbar buttons for align yet.
- Next (Day 10): CRDT core.
