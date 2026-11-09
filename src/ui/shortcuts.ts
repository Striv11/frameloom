export interface ShortcutSection {
  title: string;
  items: readonly (readonly [keys: string, what: string])[];
}

const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘' : 'Ctrl';

/** Single source for the shortcut sheet; the command palette shows the same key labels. */
export const SHORTCUTS: readonly ShortcutSection[] = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select'],
      ['R', 'Rectangle'],
      ['O', 'Ellipse'],
      ['L', 'Line'],
      ['P', 'Pen'],
      ['T', 'Text'],
      ['Esc', 'Cancel / clear selection'],
    ],
  },
  {
    title: 'Edit',
    items: [
      [`${MOD}+Z`, 'Undo'],
      [`${MOD}+Shift+Z`, 'Redo'],
      [`${MOD}+G`, 'Group'],
      [`${MOD}+Shift+G`, 'Ungroup'],
      ['Alt+drag', 'Move without snapping'],
    ],
  },
  {
    title: 'Align',
    items: [
      ['Alt+A / D', 'Align left / right'],
      ['Alt+W / S', 'Align top / bottom'],
      ['Alt+H / V', 'Center horizontally / vertically'],
      ['Alt+Shift+H / V', 'Distribute horizontally / vertically'],
    ],
  },
  {
    title: 'Components',
    items: [
      [`${MOD}+Alt+K`, 'Make component'],
      [`${MOD}+Alt+I`, 'Create instance'],
      [`${MOD}+Alt+R`, 'Reset overrides'],
      [`${MOD}+Alt+B`, 'Detach instance'],
    ],
  },
  {
    title: 'View',
    items: [
      ['Space+drag', 'Pan'],
      [`${MOD}+scroll`, 'Zoom'],
      ['0', 'Zoom to fit'],
      ['1', 'Zoom to 100%'],
      ['+ / -', 'Zoom in / out'],
      ['D', 'Toggle theme'],
    ],
  },
  {
    title: 'General',
    items: [
      [`${MOD}+K`, 'Command palette'],
      ['?', 'This sheet'],
    ],
  },
];
