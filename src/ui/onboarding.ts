import type { SceneDocument } from '../model/document';

/** True when nothing is on the canvas: the root has no children. */
export function isDocumentEmpty(doc: SceneDocument): boolean {
  return doc.root.children.length === 0;
}

export interface OnboardingActions {
  loadSample(): void;
  chooseTool(tool: 'rect' | 'ellipse' | 'pen' | 'text'): void;
  showShortcuts(): void;
}

/**
 * Empty-state card shown over a blank canvas. `update` is cheap and idempotent so it can
 * run on every history change and remote merge.
 */
export class Onboarding {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, actions: OnboardingActions) {
    const el = document.createElement('section');
    el.className = 'onboarding';
    el.setAttribute('aria-label', 'Getting started');
    el.hidden = true;
    el.innerHTML = `
      <h2>A blank canvas</h2>
      <p>Draw something, or start from a sample. Edits sync live between tabs.</p>
      <div class="onboarding-tools" role="group" aria-label="Start with a tool">
        <button class="btn" data-tool="rect">▭ Rectangle <kbd>R</kbd></button>
        <button class="btn" data-tool="ellipse">◯ Ellipse <kbd>O</kbd></button>
        <button class="btn" data-tool="pen">✒ Pen <kbd>P</kbd></button>
        <button class="btn" data-tool="text">T Text <kbd>T</kbd></button>
      </div>
      <div class="onboarding-actions">
        <button class="btn primary" data-action="sample">Load sample document</button>
        <button class="btn" data-action="shortcuts">Keyboard shortcuts <kbd>?</kbd></button>
      </div>`;
    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!target) return;
      const tool = target.dataset['tool'];
      if (tool) actions.chooseTool(tool as 'rect' | 'ellipse' | 'pen' | 'text');
      else if (target.dataset['action'] === 'sample') actions.loadSample();
      else if (target.dataset['action'] === 'shortcuts') actions.showShortcuts();
    });
    parent.appendChild(el);
    this.el = el;
  }

  update(empty: boolean): void {
    if (this.el.hidden === !empty) return;
    this.el.hidden = !empty;
  }
}
