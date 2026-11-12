# Plan

Fourteen-day arc. Every milestone has acceptance criteria that can be checked by a test or a command.
`bash check.sh` (format, typecheck, lint, unit tests, build) must pass at the end of every day; `npm run e2e` covers browser flows.

| Day | Milestone                                 | Acceptance criteria                                                                                                                                                    | Status |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Scaffold, document model, pan/zoom canvas | Vite + strict TS + Vitest + ESLint/Prettier + Playwright run in CI; Pages workflow; matrix/scene-graph/camera unit tests; demo doc renders, pans, zooms, themes in e2e | [x]    |
| 2   | R-tree spatial index                      | Bulk-load + incremental insert/remove/update; query-by-rect and point-hit match brute force on 10k random shapes (property test); hit-test 10k shapes < 0.1 ms median  | [x]    |
| 3   | Selection and transform tools             | Click/shift-click/marquee select; move, resize (8 handles), rotate with handles; transforms correct under rotated parents (unit + e2e)                                 | [x]    |
| 4   | Shape creation tools                      | Rectangle, ellipse, line tools with drag-to-create, shift = constrain, tool shortcuts (V/R/O/L); e2e creates each shape and asserts document state                     | [x]    |
| 5   | Operation log, undo/redo                  | Every mutation is an invertible op; undo/redo stack with coalescing of drags; property test: apply random ops then undo all == original document                       | [x]    |
| 6   | Pen tool and bezier editing               | Path node with cubic segments; add/drag anchors and handles, close path; path hit-testing and bounds exact for curves; unit tests on flattening and bounds             | [x]    |
| 7   | Text, layers panel, inspector             | Text node with edit-in-place; layers tree with rename/visibility/lock/reorder by drag; inspector edits position, size, fill, stroke, opacity                           | [x]    |

| 8 | Multi-select, grouping, frames | Group/ungroup (Ctrl+G), frames with clipping and drop-to-reparent, multi-select inspector with mixed values; tests for reparent preserving world transform | [x] group/ungroup, world-preserving reparent (incl. rotated parents), clipping, mixed inspector and canvas drop-to-reparent |
| 9 | Snapping and alignment guides | Snap to edges/centers of siblings and frame, equal spacing hints, 8px screen threshold; align/distribute commands; unit tests on snap solver | [x] snap solver (edges, centers, equal spacing), move integration with guides, align/distribute commands |
| 10 | CRDT core | From-scratch op-based CRDT (LWW registers per property, fractional-index ordering, tombstones); convergence property test over random interleavings of 3 replicas | [x] register-based LWW CRDT, fractional index, tombstones, cycle-safe moves, 200-seed convergence test |
| 11 | Multi-tab collaboration and persistence | BroadcastChannel transport, presence cursors, IndexedDB persistence with load on start; Playwright two-page test sees edits both ways and survives reload | [x] BroadcastChannel sync, presence cursors, IndexedDB load/save, reconcile bridge, e2e |
| 12 | Components, instances, overrides | Make component, instantiate, override fill/text per instance, propagate master edits; undo-safe; unit and e2e tests | [x] master/instance model, overrides (fill, text, ...), derived propagation, undo-safe, 9 unit tests + two-tab e2e |
| 13 | Export, command palette, shortcuts, WebGL2 | SVG and PNG export (golden-file test for SVG); command palette (Ctrl+K) with fuzzy search; shortcut sheet; WebGL2 renderer behind a flag with Canvas2D fallback | [x] SVG export with golden test, PNG export, Ctrl/⌘+K fuzzy palette, shortcut sheet, WebGL2 renderer behind `?renderer=webgl` with Canvas2D fallback |
| 14 | Polish, landing, benchmark, release | Landing section and onboarding empty state; mobile layout; benchmark script (10k shapes pan at ≥ 55 fps in headless Chromium, budgets enforced in CI); README screenshots | [x] pan benchmark enforced in e2e, onboarding empty state with product highlights (landing), narrow-screen toolbar, README screenshots regenerated via `scripts/screenshots.mjs` |

## Stretch

- Release notes / v1.0 tag; component UI (go to master); remote-edit-safe undo stacks.

- Boolean operations on paths, auto-layout frames, comments, version history snapshots.
