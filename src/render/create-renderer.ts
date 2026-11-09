import type { SceneDocument } from '../model/document';
import type { Camera } from './camera';
import { Canvas2DRenderer, type Theme } from './canvas2d';
import { WebGL2Renderer, webgl2Available } from './webgl';

/** What `main.ts` needs from a renderer; both implementations satisfy it. */
export interface Renderer {
  drawn: number;
  theme: Theme;
  overlay: ((ctx: CanvasRenderingContext2D, theme: Theme) => void) | null;
  resize(): void;
  render(): void;
}

export type RendererKind = 'canvas2d' | 'webgl';

/** `?renderer=webgl` opts in; anything else is Canvas2D. */
export function requestedRenderer(search: string): RendererKind {
  return new URLSearchParams(search).get('renderer') === 'webgl' ? 'webgl' : 'canvas2d';
}

/**
 * Builds the requested renderer, falling back to Canvas2D when WebGL2 is unavailable or fails
 * to initialise. The fallback must happen before the canvas is given a context, so we probe first
 * on a throwaway canvas and also guard construction. Returns the canvas actually in use, because
 * a failed WebGL attempt forces a replacement element.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  doc: SceneDocument,
  camera: Camera,
  kind: RendererKind,
): { renderer: Renderer; kind: RendererKind; canvas: HTMLCanvasElement } {
  if (kind === 'webgl' && webgl2Available()) {
    try {
      return { renderer: new WebGL2Renderer(canvas, doc, camera), kind: 'webgl', canvas };
    } catch (err) {
      console.warn('frameloom: WebGL2 failed, using Canvas2D', err);
      // The canvas may now hold a webgl2 context; swap in a fresh element for 2D.
      const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.replaceWith(fresh);
      return {
        renderer: new Canvas2DRenderer(fresh, doc, camera),
        kind: 'canvas2d',
        canvas: fresh,
      };
    }
  }
  return { renderer: new Canvas2DRenderer(canvas, doc, camera), kind: 'canvas2d', canvas };
}
