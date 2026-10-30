# Frameloom

> A collaborative vector design tool that runs entirely in your browser: no server, no account, no data leaves your device.

**Live demo:** https://striv11.github.io/frameloom/ (deployed by GitHub Pages)

![CI](https://github.com/Striv11/frameloom/actions/workflows/ci.yml/badge.svg)

![Frameloom canvas, light theme](docs/screenshot-light.png)
![Frameloom canvas, dark theme](docs/screenshot-dark.png)

## Problem

Design tools such as Figma and Excalidraw are either closed, server-bound or limited in scope. Designers and teams need a fast vector editor that opens instantly, works offline, and lets several tabs (and later, peers) edit the same document without a central authority.

## Motivation

Frameloom is a from-scratch exploration of the engineering inside a modern design tool:

- a **scene graph** with affine transforms, frames, groups and components;
- an **R-tree spatial index** so hit-testing and culling stay fast with 10k+ shapes;
- an **operation log** that powers undo/redo and sync;
- a hand-written **CRDT** so multiple tabs converge without conflicts;
- a **renderer** (Canvas2D now, WebGL2 later) with a performance budget enforced by a benchmark.

Everything is original code with no third-party runtime dependencies.

## Architecture

```
 input (pointer/keys)        src/main.ts, src/app
        │
        ▼
 tools ──► operations ──► SceneDocument ──► Canvas2DRenderer ──► <canvas>
 (planned)   (planned)     src/model          src/render/canvas2d
                              │  ▲
                              ▼  │
                      spatial index, CRDT, IndexedDB   (planned)
```

- `src/model/matrix.ts`: 2D affine math (`[a b c d e f]`), bounds, rect helpers.
- `src/model/types.ts`: node types (frame, group, rect, ellipse, line, text).
- `src/model/document.ts`: `SceneDocument`, a flat id → node table with parent/child links. Invariants: the root can't be removed or moved; only frames/groups hold children; reparenting can't create cycles; ids are unique. A node's local transform is `translate(x, y) · rotate(rotation)` about its top-left corner.
- `src/render/camera.ts`: world ↔ screen mapping with cursor-anchored zoom.
- `src/render/canvas2d.ts`: paint-order traversal with view-frustum culling, DPR-aware.

## Setup

Prerequisites: Node 22+.

```bash
npm ci
npm run dev        # http://localhost:5173
bash check.sh      # format, typecheck, lint, unit tests, build
npm run e2e        # Playwright (first: npx playwright install chromium)
```

Add `?stress=10000` to the URL to load 10,000 random shapes.

## Demo

Open the live link (or `npm run dev`). Drag to pan, scroll to pan, Ctrl/⌘+scroll or pinch to zoom, `0` to fit, `1` for 100%, `D` toggles light/dark. The HUD shows shape count, drawn shapes after culling, and frame time. Status: **Day 1 of 14**: viewer only; editing tools land in the following days.

## Design decisions & trade-offs

- **Flat node table, not nested objects**: cheap id lookups, easy to serialize and to express as CRDT ops.
- **Rotation about the top-left corner**: keeps the local matrix trivial; resize/rotate tools will compensate.
- **Canvas2D first, WebGL2 later**: get correctness and tests first; the renderer sits behind a narrow interface.
- **Relative Vite base**: the static build works under any Pages sub-path.

## Roadmap

See [PLAN.md](PLAN.md) for the 14-day plan with acceptance criteria.

- [x] Day 1: scaffold, document model, pan/zoom canvas
- [ ] R-tree, selection, transform and shape tools
- [ ] Undo/redo, pen tool, text, layers, inspector
- [ ] Grouping, frames, snapping
- [ ] CRDT, multi-tab collaboration, IndexedDB
- [ ] Components, export, command palette, WebGL2
- [ ] Landing, onboarding, benchmark, release

## License

MIT. See [LICENSE](LICENSE).
