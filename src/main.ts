import './style.css';
import { createDemoDocument, createStressDocument } from './app/demo';
import { Camera } from './render/camera';
import { Canvas2DRenderer, DARK, LIGHT } from './render/canvas2d';
import type { Point } from './model/matrix';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function boot(): void {
  const canvas = $<HTMLCanvasElement>('canvas');
  const stress = Number(new URLSearchParams(location.search).get('stress'));
  const doc =
    Number.isFinite(stress) && stress > 0
      ? createStressDocument(Math.min(stress, 200_000))
      : createDemoDocument();
  const camera = new Camera();
  const renderer = new Canvas2DRenderer(canvas, doc, camera);

  let dirty = true;
  const invalidate = (): void => {
    dirty = true;
  };
  let lastFrameMs = 0;
  const loop = (): void => {
    if (dirty) {
      dirty = false;
      const t0 = performance.now();
      renderer.resize();
      renderer.render();
      lastFrameMs = performance.now() - t0;
      $('zoom-label').textContent = `${Math.round(camera.zoom * 100)}%`;
      $('hud').textContent =
        `${doc.size.toLocaleString()} shapes · ${renderer.drawn.toLocaleString()} drawn · ${lastFrameMs.toFixed(1)} ms`;
    }
    requestAnimationFrame(loop);
  };

  const viewSize = (): { w: number; h: number } => ({
    w: canvas.clientWidth,
    h: canvas.clientHeight,
  });
  const fit = (): void => {
    const bounds = doc.subtreeBounds(doc.root.id);
    const { w, h } = viewSize();
    if (bounds) camera.fit(bounds, w, h);
    invalidate();
  };
  const center = (): Point => ({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
  const zoomBy = (f: number, at: Point = center()): void => {
    camera.zoomAt(at, f);
    invalidate();
  };

  function setTheme(dark: boolean): void {
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
    renderer.theme = dark ? DARK : LIGHT;
    localStorage.setItem('frameloom:theme', dark ? 'dark' : 'light');
    invalidate();
  }

  // --- Pointer input: one pointer pans, two pointers pinch-zoom. ---
  const pointers = new Map<number, Point>();
  let pinchDist = 0;
  const local = (e: PointerEvent | WheelEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchState = (): { dist: number; mid: Point } => {
    const [a, b] = [...pointers.values()] as [Point, Point];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    canvas.classList.add('panning');
    if (pointers.size === 2) pinchDist = pinchState().dist;
    $('hint').classList.add('hidden');
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (pointers.size === 1) {
      camera.panBy(cur.x - prev.x, cur.y - prev.y);
      pointers.set(e.pointerId, cur);
    } else if (pointers.size === 2) {
      const before = pinchState();
      pointers.set(e.pointerId, cur);
      const after = pinchState();
      camera.panBy(after.mid.x - before.mid.x, after.mid.y - before.mid.y);
      if (pinchDist > 0) camera.zoomAt(after.mid, after.dist / pinchDist);
      pinchDist = after.dist;
    }
    invalidate();
  });
  const endPointer = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('panning');
    if (pointers.size === 1) pinchDist = 0;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Wheel: ctrl/cmd (and trackpad pinch) zooms, otherwise pans.
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), local(e));
      else if (e.shiftKey && e.deltaX === 0) camera.panBy(-e.deltaY, 0);
      else camera.panBy(-e.deltaX, -e.deltaY);
      invalidate();
      $('hint').classList.add('hidden');
    },
    { passive: false },
  );

  // --- Toolbar and keyboard ---
  $('zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 1.25));
  $('zoom-label').addEventListener('click', () => {
    zoomBy(1 / camera.zoom);
  });
  $('fit').addEventListener('click', fit);
  $('theme').addEventListener('click', () =>
    setTheme(document.documentElement.dataset['theme'] !== 'dark'),
  );
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case '0':
        fit();
        break;
      case '1':
        zoomBy(1 / camera.zoom);
        break;
      case '+':
      case '=':
        zoomBy(1.25);
        break;
      case '-':
        zoomBy(1 / 1.25);
        break;
      case 'd':
      case 'D':
        setTheme(document.documentElement.dataset['theme'] !== 'dark');
        break;
    }
  });
  new ResizeObserver(invalidate).observe(canvas);

  const stored = localStorage.getItem('frameloom:theme');
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(stored ? stored === 'dark' : prefersDark);

  fit();
  requestAnimationFrame(loop);
  // Hook for end-to-end tests and the benchmark harness.
  (window as unknown as { __frameloom: unknown }).__frameloom = {
    doc,
    camera,
    renderer,
    invalidate,
  };
}

try {
  boot();
} catch (err) {
  const box = $('error');
  box.hidden = false;
  box.textContent = `Frameloom could not start: ${err instanceof Error ? err.message : String(err)}`;
}
