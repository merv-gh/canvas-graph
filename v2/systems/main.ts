import type { Registry } from '../core';
import { Places, Slots } from '../types';

/** Shared fold id for the entire left panel. Owned here so the hamburger
 *  in main.ts and the CSS rule on `.shell` reference the same string. */
const LEFT_PANEL_FOLD_ID = 'outline.panel';
/** Zen = fold the whole app shell (hide top + left), leaving only the canvas —
 *  the same fold concept (Principle 18) applied to the app target: "less detail
 *  on everything". Toggle with `\` (it's the only exit once panels are hidden). */
const ZEN_FOLD_ID = 'shell.zen';

export function registerMain(system: Registry) {
  system('main', ({ on, emit, contexts, contribute }) => {
    // `.shell` lives one level above the Top place. Walk up rather than reach
    // for a global selector so principle #5 (render-adjacent DOM access) holds.
    const shellEl = () => contexts.places.el(Places.Top)?.parentElement as HTMLElement | null;
    const syncShellFold = () => {
      const shell = shellEl();
      if (!shell) return;
      shell.dataset.leftFolded = contexts.fold.folded(LEFT_PANEL_FOLD_ID) ? 'true' : 'false';
      shell.dataset.topFolded = contexts.fold.folded('shell.top') ? 'true' : 'false';
      shell.dataset.zen = contexts.fold.folded(ZEN_FOLD_ID) ? 'true' : 'false';
    };
    contexts.commands.register([
      { id: 'view.left.toggle', label: 'Toggle outline.panel', group: 'view', event: 'fold.toggle', shortcut: 'B', input: { on: 'keydown', key: 'b', prevent: true }, payload: () => ({ id: 'outline.panel' }) },
      { id: 'view.top.toggle', label: 'Toggle top panel', group: 'view', event: 'fold.toggle', shortcut: 'T', input: { on: 'keydown', key: 't', prevent: true }, payload: () => ({ id: 'shell.top' }) },
      {
        id: 'view.zen',
        label: 'Toggle zen mode',
        event: 'fold.toggle',
        group: 'view',
        shortcut: '\\',
        input: { on: 'keydown', key: '\\', prevent: true },
        payload: () => ({ id: ZEN_FOLD_ID }),
      },
    ]);
    contribute({ surface: 'top', command: 'view.zen', kind: 'button', text: '⛶', order: 80 });
    contribute({ surface: 'top', command: 'view.top.toggle', kind: 'button', text: '▴', label: 'Toggle top panel', order: 79 });
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
          // Skip buttons whose command says it's unavailable. The same predicate
          // already blocks `commands.run`; checking here keeps the toolbar from
          // showing clickable buttons that do nothing.
          const cmd = contexts.commands.get(aff.command);
          if (cmd?.available && !cmd.available()) return;
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
      if (id !== LEFT_PANEL_FOLD_ID && id !== 'shell.top' && id !== ZEN_FOLD_ID) return;
      syncShellFold();
      drawToolbar();
    });
    // Debug toolbar toggles + record state changes flip the availability of
    // many command.available predicates — those are sparse events so we redraw
    // safely. Selection changes are NOT here: principle 8 budgets the toolbar
    // to ≤2 redraws under bursty mutation, and selection-dependent buttons
    // (`view.fit.selected`) accept always being rendered + a no-op click.
    on('debug.enabled.changed', drawToolbar);
    on('debug.recording.changed', drawToolbar);
  }, { requires: ['render'] });
}
