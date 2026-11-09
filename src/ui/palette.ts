import { fuzzyFilter } from './fuzzy';
import { SHORTCUTS } from './shortcuts';

export interface Command {
  id: string;
  title: string;
  /** Key label shown on the right. */
  keys?: string;
  /** Return false to hide the command right now (e.g. nothing selected). */
  enabled?: () => boolean;
  run: () => void;
}

const MAX_RESULTS = 12;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Highlights matched character positions inside `label`. */
function highlight(label: string, positions: readonly number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const hit = new Set(positions);
  let run = '';
  let runHit = false;
  const flush = (): void => {
    if (!run) return;
    if (runHit) frag.append(el('mark', undefined, run));
    else frag.append(document.createTextNode(run));
    run = '';
  };
  for (let i = 0; i < label.length; i++) {
    const h = hit.has(i);
    if (h !== runHit) flush();
    runHit = h;
    run += label[i];
  }
  flush();
  return frag;
}

/** Ctrl/⌘+K command palette with fuzzy search, plus the "?" shortcut sheet. */
export class Palette {
  private readonly root = el('div', 'overlay-backdrop');
  private readonly input = el('input', 'palette-input');
  private readonly list = el('ul', 'palette-list');
  private results: Command[] = [];
  private selected = 0;
  private restoreFocus: HTMLElement | null = null;

  constructor(
    host: HTMLElement,
    private readonly commands: () => readonly Command[],
  ) {
    this.root.hidden = true;
    const box = el('div', 'palette');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Command palette');
    this.input.type = 'text';
    this.input.placeholder = 'Type a command…';
    this.input.setAttribute('aria-label', 'Search commands');
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-controls', 'palette-list');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.list.id = 'palette-list';
    this.list.setAttribute('role', 'listbox');
    box.append(this.input, this.list);
    this.root.append(box);
    host.append(this.root);

    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.results.length;
        if (n > 0) this.select((this.selected + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runAt(this.selected);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.input.value = '';
    this.root.hidden = false;
    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.restoreFocus?.focus();
    this.restoreFocus = null;
  }

  private refresh(): void {
    const all = this.commands().filter((c) => c.enabled?.() ?? true);
    const ranked = fuzzyFilter(this.input.value, all, (c) => c.title).slice(0, MAX_RESULTS);
    this.results = ranked.map((r) => r.item);
    this.list.replaceChildren(
      ...ranked.map(({ item, match }, i) => {
        const li = el('li', 'palette-item');
        li.setAttribute('role', 'option');
        li.append(el('span', 'palette-title'));
        (li.firstChild as HTMLElement).append(highlight(item.title, match.positions));
        if (item.keys) li.append(el('kbd', undefined, item.keys));
        li.addEventListener('pointermove', () => this.select(i));
        li.addEventListener('click', () => this.runAt(i));
        return li;
      }),
    );
    if (ranked.length === 0) this.list.append(el('li', 'palette-empty', 'No matching commands'));
    this.select(0);
  }

  private select(i: number): void {
    this.selected = i;
    this.list.querySelectorAll('.palette-item').forEach((li, j) => {
      li.classList.toggle('selected', j === i);
      li.setAttribute('aria-selected', String(j === i));
      if (j === i) (li as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    });
  }

  private runAt(i: number): void {
    const cmd = this.results[i];
    if (!cmd) return;
    this.close();
    cmd.run();
  }
}

/** The "?" overlay listing every shortcut. */
export class ShortcutSheet {
  private readonly root = el('div', 'overlay-backdrop');
  private restoreFocus: HTMLElement | null = null;
  private readonly closeBtn = el('button', 'btn', '✕');

  constructor(host: HTMLElement) {
    this.root.hidden = true;
    const box = el('div', 'sheet');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Keyboard shortcuts');
    const head = el('div', 'sheet-head');
    head.append(el('h2', undefined, 'Keyboard shortcuts'), this.closeBtn);
    this.closeBtn.setAttribute('aria-label', 'Close');
    const grid = el('div', 'sheet-grid');
    for (const section of SHORTCUTS) {
      const s = el('section');
      s.append(el('h3', undefined, section.title));
      const dl = el('dl');
      for (const [keys, what] of section.items) {
        dl.append(el('dt'), el('dd', undefined, what));
        (dl.lastElementChild?.previousElementSibling as HTMLElement).append(
          el('kbd', undefined, keys),
        );
      }
      s.append(dl);
      grid.append(s);
    }
    box.append(head, grid);
    this.root.append(box);
    host.append(this.root);
    this.closeBtn.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.closeBtn.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.restoreFocus?.focus();
    this.restoreFocus = null;
  }
}
