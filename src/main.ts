import './style.css';
import { createDemoDocument, createStressDocument } from './app/demo';
import { Camera } from './render/camera';
import { Canvas2DRenderer, DARK, LIGHT } from './render/canvas2d';
import { applyToPoint, type Point } from './model/matrix';
import { drawOverlay } from './render/overlay';
import { History } from './model/history';
import { SceneIndex } from './spatial/scene-index';
import { selectionFrame } from './tools/handles';
import { CreateTool, TOOL_SHORTCUTS } from './tools/create-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { TextTool } from './tools/text-tool';
import { applyField, inspect, type FieldKey } from './tools/inspector';

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
  const index = new SceneIndex(doc);
  const history = new History(doc, 500, () => {
    updateHistoryButtons();
  });
  const camera = new Camera();
  const renderer = new Canvas2DRenderer(canvas, doc, camera);

  let dirty = true;
  const invalidate = (): void => {
    dirty = true;
  };
  type ToolName = 'select' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text';
  let active: ToolName = 'select';
  const setTool = (name: ToolName): void => {
    if (create.dragging) create.cancel();
    if (select.dragging) select.cancel();
    pen.finish();
    endTextEdit();
    active = name;
    if (name === 'rect' || name === 'ellipse' || name === 'line') create.kind = name;
    if (name !== 'select') {
      select.hover = null;
    }
    for (const t of ['select', 'rect', 'ellipse', 'line', 'pen', 'text'] as const) {
      const b = $(`tool-${t}`);
      b.classList.toggle('active', t === name);
      b.setAttribute('aria-pressed', String(t === name));
    }
    canvas.classList.toggle('creating', name !== 'select');
    invalidate();
  };
  function updateHistoryButtons(): void {
    const u = document.getElementById('undo') as HTMLButtonElement | null;
    const r = document.getElementById('redo') as HTMLButtonElement | null;
    if (u) u.disabled = !history.canUndo;
    if (r) r.disabled = !history.canRedo;
  }
  const stepHistory = (dir: 'undo' | 'redo'): void => {
    if (create.dragging || tool.dragging || pen.active) return;
    if (!history[dir]()) return;
    index.rebuild();
    tool.selection.prune(doc);
    invalidate();
  };
  const create = new CreateTool(
    doc,
    index,
    camera,
    (id) => {
      select.selection.replace([id]);
      setTool('select');
    },
    invalidate,
    history,
  );
  const pen = new PenTool(
    doc,
    index,
    camera,
    (id) => select.selection.replace([id]),
    invalidate,
    history,
  );
  const measureCtx = document.createElement('canvas').getContext('2d');
  const textTool = new TextTool(
    doc,
    index,
    camera,
    (text, fontSize, fontFamily) => {
      if (!measureCtx) return { width: text.length * fontSize * 0.6, height: fontSize * 1.25 };
      measureCtx.font = `${fontSize}px ${fontFamily}`;
      const lines = text.split('\n');
      return {
        width: Math.ceil(Math.max(...lines.map((l) => measureCtx.measureText(l).width))),
        height: Math.ceil(lines.length * fontSize * 1.25),
      };
    },
    invalidate,
    history,
  );
  const editor = $<HTMLTextAreaElement>('text-editor');
  function placeEditor(): void {
    const id = textTool.editing;
    if (!id || !doc.has(id)) return;
    const n = doc.get(id);
    const p = camera.worldToScreen(applyToPoint(doc.worldMatrix(id), { x: 0, y: 0 }));
    editor.style.left = `${p.x}px`;
    editor.style.top = `${p.y}px`;
    editor.style.fontSize = `${('fontSize' in n ? n.fontSize : 16) * camera.zoom}px`;
    editor.style.minWidth = `${Math.max(n.width * camera.zoom, 40)}px`;
  }
  function startTextEdit(id: string | null): void {
    if (!id) return;
    const n = doc.get(id);
    editor.hidden = false;
    editor.value = n.type === 'text' ? n.text : '';
    placeEditor();
    requestAnimationFrame(() => editor.focus());
    invalidate();
  }
  function endTextEdit(): void {
    if (!textTool.active) return;
    const id = textTool.commit();
    editor.hidden = true;
    if (id) select.selection.replace([id]);
    refreshInspector();
    invalidate();
  }
  editor.addEventListener('input', () => {
    textTool.setText(editor.value);
    placeEditor();
  });
  editor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (e.key === 'Escape') {
        textTool.cancel();
        editor.hidden = true;
        invalidate();
      } else endTextEdit();
      setTool('select');
    }
  });
  editor.addEventListener('blur', () => {
    if (textTool.active) {
      endTextEdit();
      if (active === 'text') setTool('select');
    }
  });

  // --- Inspector ---
  const panel = $('inspector');
  const LABELS: Record<FieldKey, string> = {
    x: 'X',
    y: 'Y',
    width: 'W',
    height: 'H',
    rotation: 'Rotation °',
    opacity: 'Opacity %',
    fill: 'Fill',
    stroke: 'Stroke',
    strokeWidth: 'Stroke width',
  };
  let inspectorKey = '';
  function refreshInspector(): void {
    const ids = select.selection.ids.filter((id) => doc.has(id));
    const fields = inspect(doc, ids);
    panel.hidden = fields.length === 0;
    if (fields.length === 0) {
      inspectorKey = '';
      return;
    }
    // Rebuild only when the set of rows changes; otherwise update values in place.
    const key = ids.join(',') + fields.map((f) => (f.editable ? '1' : '0')).join('');
    if (key !== inspectorKey) {
      inspectorKey = key;
      panel.replaceChildren();
      const title = document.createElement('h2');
      title.textContent =
        ids.length === 1 ? doc.get(ids[0] as string).name : `${ids.length} selected`;
      panel.append(title);
      for (const f of fields) {
        const row = document.createElement('label');
        row.className = 'row';
        const span = document.createElement('span');
        span.textContent = LABELS[f.key];
        const input = document.createElement('input');
        input.dataset['field'] = f.key;
        input.disabled = !f.editable;
        input.autocomplete = 'off';
        input.addEventListener('change', () => {
          applyField(doc, history, select.selection.ids, f.key, input.value);
          index.rebuild();
          refreshInspector();
          invalidate();
        });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') input.blur();
        });
        row.append(span, input);
        panel.append(row);
      }
    }
    for (const f of fields) {
      const input = panel.querySelector<HTMLInputElement>(`[data-field="${f.key}"]`);
      if (!input || document.activeElement === input) continue;
      input.value = f.value.mixed ? '' : String(f.value.value ?? 'none');
      input.placeholder = f.value.mixed ? 'Mixed' : '';
    }
  }
  // The overlay and pointer code talk to whichever tool is active.
  const select = new SelectTool(doc, index, camera, invalidate, history);
  const tool = select;
  renderer.overlay = (ctx, theme) => {
    const ids = tool.selection.ids.filter((id) => doc.has(id));
    drawOverlay(ctx, theme, camera, {
      frame: tool.frame(),
      outlines: ids.length > 1 ? ids.flatMap((id) => selectionFrame(doc, [id]) ?? []) : [],
      marquee: tool.marquee,
      pen: pen.preview(),
      hover:
        tool.hover && !tool.dragging && !tool.selection.has(tool.hover) && doc.has(tool.hover)
          ? selectionFrame(doc, [tool.hover])
          : null,
    });
  };
  const hudSuffix = (): string => {
    const n = tool.selection.size;
    if (n > 0) return ` · ${n} selected`;
    const hover = tool.hover && doc.has(tool.hover) ? doc.get(tool.hover) : null;
    return hover ? ` · ${hover.name || hover.type}` : '';
  };
  let lastFrameMs = 0;
  const loop = (): void => {
    if (dirty) {
      dirty = false;
      refreshInspector();
      placeEditor();
      const t0 = performance.now();
      renderer.resize();
      renderer.render();
      lastFrameMs = performance.now() - t0;
      $('zoom-label').textContent = `${Math.round(camera.zoom * 100)}%`;
      $('hud').textContent =
        `${doc.size.toLocaleString()} shapes · ${renderer.drawn.toLocaleString()} drawn · ${lastFrameMs.toFixed(1)} ms${hudSuffix()}`;
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

  // --- Pointer input ---
  // Primary button drives the select tool. Middle button or Space+drag pans;
  // two pointers pinch-zoom (and pan).
  const pointers = new Map<number, Point>();
  let panning = false;
  let spaceDown = false;
  let pinchDist = 0;
  const local = (e: MouseEvent): Point => {
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
  const mods = (e: PointerEvent): { shift: boolean } => ({ shift: e.shiftKey });
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    $('hint').classList.add('hidden');
    if (pointers.size === 2) {
      tool.cancel();
      create.cancel();
      pen.cancel();
      panning = true;
      pinchDist = pinchState().dist;
    } else if (pointers.size === 1) {
      panning = e.button === 1 || spaceDown;
      if (panning) canvas.classList.add('panning');
      else if (e.button === 0) {
        if (active === 'select') tool.pointerDown(local(e), mods(e));
        else if (active === 'text') {
          startTextEdit(textTool.begin(local(e)));
          e.preventDefault();
        } else if (active === 'pen') {
          pen.pointerDown(local(e));
          if (!pen.active) setTool('select');
        } else create.pointerDown(local(e));
      }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (active === 'select') tool.pointerMove(local(e), mods(e));
      return;
    }
    const cur = local(e);
    if (pointers.size === 1) {
      if (panning) camera.panBy(cur.x - prev.x, cur.y - prev.y);
      else if (active === 'select') tool.pointerMove(cur, mods(e));
      else if (active === 'pen') pen.pointerMove(cur);
      else create.pointerMove(cur, mods(e));
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
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 0) {
      if (create.dragging) create.pointerUp(local(e));
      pen.pointerUp();
      tool.pointerUp();
      panning = false;
      canvas.classList.remove('panning');
    }
    if (pointers.size === 1) pinchDist = 0;
  };
  canvas.addEventListener('dblclick', (e) => {
    if (active !== 'select') return;
    const id = index.hitTest(camera.screenToWorld(local(e)));
    if (id && doc.get(id).type === 'text' && textTool.edit(id)) startTextEdit(id);
  });
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', (e) => {
    tool.cancel();
    create.cancel();
    pen.cancel();
    endPointer(e);
  });

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
  for (const t of ['select', 'rect', 'ellipse', 'line', 'pen', 'text'] as const)
    $(`tool-${t}`).addEventListener('click', () => setTool(t));
  $('undo').addEventListener('click', () => stepHistory('undo'));
  $('redo').addEventListener('click', () => stepHistory('redo'));
  $('fit').addEventListener('click', fit);
  $('theme').addEventListener('click', () =>
    setTheme(document.documentElement.dataset['theme'] !== 'dark'),
  );
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      canvas.classList.remove('space');
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') stepHistory(e.shiftKey ? 'redo' : 'undo');
      else if (k === 'y') stepHistory('redo');
      else return;
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      spaceDown = true;
      canvas.classList.add('space');
      e.preventDefault();
      return;
    }
    const shortcut = TOOL_SHORTCUTS[e.key.toLowerCase()];
    if (shortcut && !e.shiftKey && !tool.dragging && !create.dragging) {
      setTool(shortcut);
      return;
    }
    switch (e.key) {
      case 'Enter':
        if (pen.active) setTool('select');
        break;
      case 'Escape':
        if (pen.active) setTool('select');
        else if (create.dragging) create.cancel();
        else if (tool.dragging) tool.cancel();
        else if (active !== 'select') setTool('select');
        else {
          tool.selection.clear();
          invalidate();
        }
        break;
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
    index,
    tool,
    create,
    pen,
    history,
    textTool,
    stepHistory,
    setTool,
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
