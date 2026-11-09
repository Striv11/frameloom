import type { SceneDocument } from '../model/document';
import { ROOT_ID } from '../model/document';
import { applyToPoint, multiply, type Matrix, type Point, type Rect } from '../model/matrix';
import type { NodeId, SceneNode } from '../model/types';
import type { Camera } from './camera';
import { intersectsView, type Theme } from './canvas2d';
import { outline, parseColor, strokeTriangles, triangulate, type Rgba } from './tessellate';
import { LIGHT } from './canvas2d';

const VERT = `#version 300 es
in vec2 a_pos;
in vec4 a_color;
in vec2 a_uv;
uniform vec2 u_view;
out vec4 v_color;
out vec2 v_uv;
void main() {
  vec2 clip = vec2(a_pos.x / u_view.x * 2.0 - 1.0, 1.0 - a_pos.y / u_view.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
  v_uv = a_uv;
}`;

// Colors arrive premultiplied; a textured draw multiplies the (premultiplied) glyph bitmap by alpha.
const FRAG = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_textured;
out vec4 outColor;
void main() {
  if (u_textured > 0.5) outColor = texture(u_tex, v_uv) * v_color.a;
  else outColor = v_color;
}`;

const FLOATS = 8; // x y r g b a u v
const MAX_VERTS = 60_000;

interface TextEntry {
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** True when a WebGL2 context can be created (used to pick a renderer and to fall back). */
export function webgl2Available(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * WebGL2 renderer. Same surface as `Canvas2DRenderer`. Shapes are tessellated on the CPU into
 * one batched triangle stream (premultiplied alpha, MSAA), clipping frames use the stencil
 * buffer, and text is rasterized once into cached textures. The selection overlay lives on a
 * transparent Canvas2D layered above, since one canvas can't hold both context types.
 */
export class WebGL2Renderer {
  drawn = 0;
  overlay: ((ctx: CanvasRenderingContext2D, theme: Theme) => void) | null = null;
  private readonly gl: WebGL2RenderingContext;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly uView: WebGLUniformLocation;
  private readonly uTextured: WebGLUniformLocation;
  private data = new Float32Array(MAX_VERTS * FLOATS);
  private verts = 0;
  private stencilDepth = 0;
  private readonly textCache = new Map<string, TextEntry>();
  private readonly scratch = document.createElement('canvas');

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly doc: SceneDocument,
    private readonly camera: Camera,
    public theme: Theme = LIGHT,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      stencil: true,
      premultipliedAlpha: true,
    });
    const ctx2d = document.createElement('canvas').getContext('2d');
    if (!gl || !ctx2d) throw new Error('WebGL2 is not supported in this browser');
    this.gl = gl;
    this.overlayCanvas = ctx2d.canvas;
    this.overlayCtx = ctx2d;
    this.overlayCanvas.className = 'overlay-canvas';
    this.overlayCanvas.setAttribute('aria-hidden', 'true');
    canvas.insertAdjacentElement('afterend', this.overlayCanvas);

    this.program = link(gl, VERT, FRAG);
    gl.useProgram(this.program);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('WebGL buffer allocation failed');
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    for (const [name, size, offset] of [
      ['a_pos', 2, 0],
      ['a_color', 4, 8],
      ['a_uv', 2, 24],
    ] as const) {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    this.uView = must(gl.getUniformLocation(this.program, 'u_view'));
    this.uTextured = must(gl.getUniformLocation(this.program, 'u_textured'));
    gl.uniform1i(must(gl.getUniformLocation(this.program, 'u_tex')), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.STENCIL_TEST);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    for (const c of [this.canvas, this.overlayCanvas]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
    }
  }

  render(): void {
    const { gl, canvas, camera } = this;
    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas.width / dpr;
    const viewH = canvas.height / dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const bg = parseColor(this.theme.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.uniform2f(this.uView, viewW, viewH);
    this.verts = 0;
    this.stencilDepth = 0;
    this.setStencil('draw');

    this.drawGrid(viewW, viewH);
    const view: Rect = {
      ...camera.screenToWorld({ x: 0, y: 0 }),
      width: viewW / camera.zoom,
      height: viewH / camera.zoom,
    };
    this.drawn = 0;
    for (const id of this.doc.find(ROOT_ID)?.children ?? [])
      this.drawNode(id, camera.matrix, view, 1);
    this.flush();

    const o = this.overlayCtx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    if (this.overlay) {
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.globalAlpha = 1;
      this.overlay(o, this.theme);
    }
  }

  private setStencil(mode: 'draw' | 'inc' | 'dec'): void {
    const { gl } = this;
    gl.stencilFunc(gl.EQUAL, this.stencilDepth, 0xff);
    if (mode === 'draw') {
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.colorMask(true, true, true, true);
    } else {
      gl.stencilOp(gl.KEEP, gl.KEEP, mode === 'inc' ? gl.INCR : gl.DECR);
      gl.colorMask(false, false, false, false);
    }
  }

  private flush(): void {
    if (this.verts === 0) return;
    const { gl } = this;
    gl.uniform1f(this.uTextured, 0);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.verts * FLOATS);
    gl.drawArrays(gl.TRIANGLES, 0, this.verts);
    this.verts = 0;
  }

  private vertex(x: number, y: number, c: Rgba, a: number, u = 0, v = 0): void {
    if (this.verts >= MAX_VERTS) this.flush();
    const d = this.data;
    const o = this.verts * FLOATS;
    const alpha = c[3] * a;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = c[0] * alpha;
    d[o + 3] = c[1] * alpha;
    d[o + 4] = c[2] * alpha;
    d[o + 5] = alpha;
    d[o + 6] = u;
    d[o + 7] = v;
    this.verts += 1;
  }

  /** Emits a filled polygon given in local space, transformed by `m`. */
  private fillPolygon(pts: readonly Point[], m: Matrix, color: Rgba, alpha: number): void {
    const tri = triangulate(pts);
    if (tri.length === 0) return;
    const sp = pts.map((p) => applyToPoint(m, p));
    for (let i = 0; i < tri.length; i += 3) {
      // Never split a triangle across a flush: keep the three vertices contiguous.
      if (this.verts + 3 > MAX_VERTS) this.flush();
      for (let k = 0; k < 3; k++) {
        const p = sp[tri[i + k] as number] as Point;
        this.vertex(p.x, p.y, color, alpha);
      }
    }
  }

  private drawStroke(
    pts: readonly Point[],
    width: number,
    closed: boolean,
    m: Matrix,
    color: Rgba,
    alpha: number,
    scale: number,
  ): void {
    const t = strokeTriangles(pts, width, closed, scale);
    for (let i = 0; i < t.length; i += 6) {
      if (this.verts + 3 > MAX_VERTS) this.flush();
      for (let k = 0; k < 3; k++) {
        const p = applyToPoint(m, { x: t[i + k * 2] as number, y: t[i + k * 2 + 1] as number });
        this.vertex(p.x, p.y, color, alpha);
      }
    }
  }

  private drawNode(id: NodeId, parentM: Matrix, view: Rect, parentAlpha: number): void {
    const n = this.doc.get(id);
    if (!n.visible) return;
    const m = multiply(parentM, this.doc.localMatrix(id));
    const alpha = parentAlpha * n.opacity;
    const clips = n.type === 'frame' && n.clip;
    if ((clips || n.children.length === 0) && !intersectsView(this.doc.worldBounds(id), view))
      return;

    this.drawShape(n, m, alpha);
    this.drawn += 1;
    if (clips) {
      const box = outline(n, this.camera.zoom) ?? [];
      this.flush();
      this.setStencil('inc');
      this.fillPolygon(box, m, [1, 1, 1, 1], 1);
      this.flush();
      this.stencilDepth += 1;
      this.setStencil('draw');
      for (const child of n.children) this.drawNode(child, m, view, alpha);
      this.flush();
      this.setStencil('dec');
      this.fillPolygon(box, m, [1, 1, 1, 1], 1);
      this.flush();
      this.stencilDepth -= 1;
      this.setStencil('draw');
    } else {
      for (const child of n.children) this.drawNode(child, m, view, alpha);
    }
  }

  private drawShape(n: SceneNode, m: Matrix, alpha: number): void {
    const scale = this.camera.zoom;
    if (n.type === 'text') {
      this.drawText(n, m, alpha);
      return;
    }
    if (n.type === 'line') {
      if (n.stroke && n.strokeWidth > 0)
        this.drawStroke(
          [
            { x: 0, y: 0 },
            { x: n.width, y: n.height },
          ],
          n.strokeWidth,
          false,
          m,
          parseColor(n.stroke),
          alpha,
          scale,
        );
      return;
    }
    const pts = outline(n, scale);
    if (!pts) return;
    const closed = n.type !== 'path' || n.closed;
    if (n.fill && closed) this.fillPolygon(pts, m, parseColor(n.fill), alpha);
    if (n.stroke && n.strokeWidth > 0)
      this.drawStroke(pts, n.strokeWidth, closed, m, parseColor(n.stroke), alpha, scale);
  }

  private drawText(n: SceneNode & { type: 'text' }, m: Matrix, alpha: number): void {
    if (!n.fill || n.text === '') return;
    const dpr = window.devicePixelRatio || 1;
    // Rasterize at roughly screen resolution, in coarse steps so zooming reuses textures.
    const res = Math.min(
      4,
      Math.pow(2, Math.ceil(Math.log2(Math.max(0.25, this.camera.zoom * dpr)))),
    );
    const key = `${res}|${n.fontSize}px ${n.fontFamily}|${n.fill}|${n.text}`;
    let entry: TextEntry | null | undefined = this.textCache.get(key);
    if (!entry) {
      entry = this.makeText(n, res);
      if (!entry) return;
      if (this.textCache.size > 256) this.clearTextCache();
      this.textCache.set(key, entry);
    }
    const { gl } = this;
    this.flush();
    const w = entry.w / res;
    const h = entry.h / res;
    const quad: [number, number, number, number][] = [
      [0, 0, 0, 0],
      [w, 0, 1, 0],
      [0, h, 0, 1],
      [w, 0, 1, 0],
      [w, h, 1, 1],
      [0, h, 0, 1],
    ];
    for (const [x, y, u, v] of quad) {
      const p = applyToPoint(m, { x, y });
      this.vertex(p.x, p.y, [1, 1, 1, 1], alpha, u, v);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.uniform1f(this.uTextured, 1);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.verts * FLOATS);
    gl.drawArrays(gl.TRIANGLES, 0, this.verts);
    this.verts = 0;
  }

  private makeText(n: SceneNode & { type: 'text' }, res: number): TextEntry | null {
    const { gl, scratch } = this;
    const ctx = scratch.getContext('2d');
    if (!ctx || !n.fill) return null;
    const font = `${n.fontSize}px ${n.fontFamily}`;
    ctx.font = font;
    const w = Math.max(1, Math.ceil(Math.max(n.width, ctx.measureText(n.text).width) * res));
    const h = Math.max(1, Math.ceil(Math.max(n.height, n.fontSize * 1.3) * res));
    scratch.width = w;
    scratch.height = h;
    ctx.setTransform(res, 0, 0, res, 0, 0);
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = n.fill;
    ctx.fillText(n.text, 0, 0);
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w: scratch.width, h: scratch.height };
  }

  private clearTextCache(): void {
    for (const e of this.textCache.values()) this.gl.deleteTexture(e.tex);
    this.textCache.clear();
  }

  private drawGrid(viewW: number, viewH: number): void {
    const { camera } = this;
    let step = 16;
    while (step * camera.zoom < 16) step *= 4;
    const px = step * camera.zoom;
    if (px < 8) return;
    const color = parseColor(this.theme.grid);
    const mod = (a: number, b: number): number => ((a % b) + b) % b;
    const line = (x0: number, y0: number, x1: number, y1: number): void => {
      if (this.verts + 6 > MAX_VERTS) this.flush();
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as const)
        this.vertex(x, y, color, 1);
    };
    for (let x = mod(camera.panX, px); x < viewW; x += px) {
      const r = Math.round(x);
      line(r, 0, r + 1, viewH);
    }
    for (let y = mod(camera.panY, px); y < viewH; y += px) {
      const r = Math.round(y);
      line(0, r, viewW, r + 1);
    }
  }
}

function must<T>(v: T | null): T {
  if (v === null) throw new Error('WebGL resource lookup failed');
  return v;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const s = must(gl.createShader(type));
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s) ?? ''}`);
    return s;
  };
  const p = must(gl.createProgram());
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(p) ?? ''}`);
  return p;
}
