import type { SceneDocument } from '../model/document';
import { ROOT_ID } from '../model/document';
import { multiply, type Matrix, type Rect } from '../model/matrix';
import type { NodeId, SceneNode } from '../model/types';
import type { Camera } from './camera';

export interface Theme {
  background: string;
  grid: string;
  /** Selection outlines, handles and the marquee. */
  accent: string;
  /** Fill of handle squares. */
  handleFill: string;
}

export const LIGHT: Theme = {
  background: '#f1f2f4',
  grid: 'rgba(20,24,40,0.07)',
  accent: '#5b4bd6',
  handleFill: '#ffffff',
};
export const DARK: Theme = {
  background: '#16181d',
  grid: 'rgba(255,255,255,0.06)',
  accent: '#9a8cff',
  handleFill: '#1f2229',
};

/** Canvas2D renderer. Draws the scene graph in paint order with per-frame culling. */
export class Canvas2DRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Number of nodes actually drawn last frame (useful for the HUD and benchmarks). */
  drawn = 0;
  /** Optional screen-space overlay (selection, handles) painted after the scene. */
  overlay: ((ctx: CanvasRenderingContext2D, theme: Theme) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly doc: SceneDocument,
    private readonly camera: Camera,
    public theme: Theme = LIGHT,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
    this.ctx = ctx;
  }

  /** Resizes the backing store to the CSS size times devicePixelRatio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(): void {
    const { ctx, canvas, camera } = this;
    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawGrid(viewW, viewH);

    const view: Rect = {
      ...camera.screenToWorld({ x: 0, y: 0 }),
      width: viewW / camera.zoom,
      height: viewH / camera.zoom,
    };
    const base = multiply([dpr, 0, 0, dpr, 0, 0], camera.matrix);
    this.drawn = 0;
    for (const id of this.doc.find(ROOT_ID)?.children ?? []) this.drawNode(id, base, view, 1);
    if (this.overlay) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      this.overlay(ctx, this.theme);
    }
  }

  private drawNode(id: NodeId, parentM: Matrix, view: Rect, parentAlpha: number): void {
    const { ctx, doc } = this;
    const n = doc.get(id);
    if (!n.visible) return;
    const m = multiply(parentM, doc.localMatrix(id));
    const alpha = parentAlpha * n.opacity;

    // Cull only leaves and clipping frames; groups' bounds don't cover their children.
    const clips = n.type === 'frame' && n.clip;
    if ((clips || n.children.length === 0) && !intersectsView(doc.worldBounds(id), view)) return;

    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = alpha;
    this.drawShape(n);
    this.drawn += 1;
    if (clips) {
      ctx.beginPath();
      roundRectPath(ctx, 0, 0, n.width, n.height, n.cornerRadius);
      ctx.clip();
    }
    // Children are drawn in this node's space; restore state afterwards.
    for (const child of n.children) this.drawNode(child, m, view, alpha);
    ctx.restore();
  }

  private drawShape(n: SceneNode): void {
    const { ctx } = this;
    ctx.beginPath();
    switch (n.type) {
      case 'frame':
      case 'rect':
        roundRectPath(ctx, 0, 0, n.width, n.height, n.cornerRadius);
        break;
      case 'ellipse':
        ctx.ellipse(n.width / 2, n.height / 2, n.width / 2, n.height / 2, 0, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.moveTo(0, 0);
        ctx.lineTo(n.width, n.height);
        break;
      case 'text':
        ctx.font = `${n.fontSize}px ${n.fontFamily}`;
        ctx.textBaseline = 'top';
        if (n.fill) {
          ctx.fillStyle = n.fill;
          ctx.fillText(n.text, 0, 0);
        }
        return;
      case 'group':
        return;
    }
    if (n.fill && n.type !== 'line') {
      ctx.fillStyle = n.fill;
      ctx.fill();
    }
    if (n.stroke && n.strokeWidth > 0) {
      ctx.strokeStyle = n.stroke;
      ctx.lineWidth = n.strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  private drawGrid(viewW: number, viewH: number): void {
    const { ctx, camera } = this;
    // Pick a world-space step so grid lines stay 16-64+ px apart on screen.
    let step = 16;
    while (step * camera.zoom < 16) step *= 4;
    const px = step * camera.zoom;
    if (px < 8) return;
    ctx.beginPath();
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    for (let x = mod(camera.panX, px); x < viewW; x += px) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, viewH);
    }
    for (let y = mod(camera.panY, px); y < viewH; y += px) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(viewW, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }
}

export function intersectsView(b: Rect, view: Rect): boolean {
  return (
    b.x <= view.x + view.width &&
    view.x <= b.x + b.width &&
    b.y <= view.y + view.height &&
    view.y <= b.y + b.height
  );
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r > 0) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
}
