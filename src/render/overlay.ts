import { applyToPoint, type Matrix, type Point, type Rect } from '../model/matrix';
import type { PathAnchor } from '../model/path';
import type { Camera } from './camera';
import type { Theme } from './canvas2d';
import { handlePoints, type SelectionFrame } from '../tools/handles';

export interface OverlayState {
  frame: SelectionFrame | null;
  /** Outline frames for individually selected nodes when several are selected. */
  outlines: SelectionFrame[];
  marquee: Rect | null;
  hover: SelectionFrame | null;
  /** In-progress pen path: anchors in the space of `matrix` (local -> world). */
  pen?: { anchors: readonly PathAnchor[]; matrix: Matrix } | null;
}

const HANDLE_SIZE = 8;

function strokeFrame(ctx: CanvasRenderingContext2D, camera: Camera, f: SelectionFrame): Point[] {
  const corners = [
    { x: 0, y: 0 },
    { x: f.width, y: 0 },
    { x: f.width, y: f.height },
    { x: 0, y: f.height },
  ].map((p) => camera.worldToScreen(applyToPoint(f.matrix, p)));
  ctx.beginPath();
  corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  return corners;
}

/** Paints hover outline, selection boxes, handles and the marquee in screen space. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  camera: Camera,
  state: OverlayState,
): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.accent;
  if (state.hover) {
    ctx.globalAlpha = 0.6;
    strokeFrame(ctx, camera, state.hover);
    ctx.globalAlpha = 1;
  }
  for (const o of state.outlines) strokeFrame(ctx, camera, o);
  if (state.pen) drawPenAnchors(ctx, theme, camera, state.pen.anchors, state.pen.matrix);
  const frame = state.frame;
  if (frame) {
    ctx.lineWidth = 1.5;
    strokeFrame(ctx, camera, frame);
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.handleFill;
    const points = handlePoints(frame, camera);
    const top = points.find((p) => p.kind === 'rotate');
    if (top) {
      const anchor = camera.worldToScreen(applyToPoint(frame.matrix, { x: frame.width / 2, y: 0 }));
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(top.screen.x, top.screen.y);
      ctx.stroke();
    }
    for (const p of points) {
      ctx.beginPath();
      if (p.kind === 'rotate') ctx.arc(p.screen.x, p.screen.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
      else
        ctx.rect(
          p.screen.x - HANDLE_SIZE / 2,
          p.screen.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE,
        );
      ctx.fill();
      ctx.stroke();
    }
  }
  if (state.marquee) {
    const a = camera.worldToScreen({ x: state.marquee.x, y: state.marquee.y });
    const w = state.marquee.width * camera.zoom;
    const h = state.marquee.height * camera.zoom;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(a.x, a.y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
  }
}

function drawPenAnchors(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  camera: Camera,
  anchors: readonly PathAnchor[],
  matrix: Matrix,
): void {
  const toScreen = (x: number, y: number): Point =>
    camera.worldToScreen(applyToPoint(matrix, { x, y }));
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.accent;
  ctx.fillStyle = theme.handleFill;
  for (const a of anchors) {
    const p = toScreen(a.x, a.y);
    if (a.outX !== 0 || a.outY !== 0) {
      const o = toScreen(a.x + a.outX, a.y + a.outY);
      const i = toScreen(a.x + a.inX, a.y + a.inY);
      ctx.beginPath();
      ctx.moveTo(i.x, i.y);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
      for (const h of [i, o]) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
  }
}
