import type { Registry } from '../core';
import { Places, Slots } from '../types';

/** Shared fold id for the entire left panel. Owned here so the hamburger
 *  in main.ts and the CSS rule on `.shell` reference the same string. */
const LEFT_PANEL_FOLD_ID = 'outline.panel';

export function registerMain(system: Registry) {
  system('main', ({ on, emit, contexts }) => {
    // `.shell` lives one level above the Top place. Walk up rather than reach
    // for a global selector so principle #5 (render-adjacent DOM access) holds.
    const shellEl = () => contexts.places.el(Places.Top)?.parentElement as HTMLElement | null;
    const syncShellFold = () => {
      const shell = shellEl();
      if (!shell) return;
      const folded = !contexts.fold.isOpen(LEFT_PANEL_FOLD_ID, true);
      shell.dataset.leftFolded = folded ? 'true' : 'false';
    };
    const hamburger = () => {
      const folded = !contexts.fold.isOpen(LEFT_PANEL_FOLD_ID, true);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-button hamburger';
      btn.dataset.foldId = LEFT_PANEL_FOLD_ID;
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      btn.setAttribute('aria-label', folded ? 'Show panel' : 'Hide panel');
      btn.textContent = '☰';
      return btn;
    };
    const drawToolbar = () => emit('render.view.set', {
      place: Places.Top,
      key: 'toolbar',
      view: () => {
        const root = contexts.templates.clone('toolbar');
        const start = contexts.templates.slot(root, 'start');
        const end = contexts.templates.slot(root, 'end');
        // Hamburger always lives at the very left of the toolbar — clicking it
        // fires fold.toggle for the left panel via [data-fold-id] selector.
        start.append(hamburger());
        contexts.affordances.system('top').forEach(aff => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.command = aff.command;
          button.textContent = aff.text ?? aff.command;
          if (aff.label) button.setAttribute('aria-label', aff.label);
          if (aff.className) button.classList.add(...aff.className.split(/\s+/).filter(Boolean));
          (aff.slot === Slots.End ? end : start).append(button);
        });
        return root;
      },
    });
    on('app.start', () => { emit('render.shell'); drawToolbar(); syncShellFold(); });
    on('affordance.contributed', ({ surface }) => { if (surface === 'top') drawToolbar(); });
    // The shell class flips on every fold of the left panel; the hamburger
    // aria + glyph also flips, so the toolbar redraws too.
    on('fold.changed', ({ id }) => {
      if (id !== LEFT_PANEL_FOLD_ID) return;
      syncShellFold();
      drawToolbar();
    });
  }, { requires: ['render'] });
}
