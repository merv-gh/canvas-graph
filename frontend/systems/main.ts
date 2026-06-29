import type { Registry } from '../core';
import { Places } from '../types';

/** Zen = fold the whole app shell (hide top), leaving only the canvas —
 *  the same fold concept (Principle 18) applied to the app target: "less detail
 *  on everything". Toggle with `\` (it's the only exit once panels are hidden). */
const ZEN_FOLD_ID = 'shell.zen';

export function registerMain(system: Registry) {
  system('main', ({ on, emit, contexts, contribute, origin }) => {
    // Escape exits zen mode through the shared cancellation stack.
    contexts.cancellation.register({
      origin,
      active: () => contexts.fold.folded(ZEN_FOLD_ID),
      cancel: () => contexts.fold.set(ZEN_FOLD_ID, true),
    });

    // `.shell` lives one level above the Top place. Walk up rather than reach
    // for a global selector so principle #5 (render-adjacent DOM access) holds.
    const shellEl = () => contexts.places.el(Places.Top)?.parentElement as HTMLElement | null;
    const syncShellFold = () => {
      const shell = shellEl();
      if (!shell) return;
      shell.dataset.topFolded = contexts.fold.folded('shell.top') ? 'true' : 'false';
      shell.dataset.zen = contexts.fold.folded(ZEN_FOLD_ID) ? 'true' : 'false';
    };
    contexts.commands.register([
      { id: 'view.left.toggle', label: 'Toggle outline panel', group: 'view', event: 'fold.toggle', shortcut: 'B', input: { on: 'keydown', key: 'b', prevent: true }, payload: () => ({ id: 'outline.panel' }) },
      { id: 'view.top.toggle', label: 'Toggle top panel', group: 'view', event: 'fold.toggle', shortcut: 'Shift+T', input: { on: 'keydown', key: 'T', shift: true, prevent: true }, payload: () => ({ id: 'shell.top' }) },
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
    on('app.start', () => { emit('render.shell'); syncShellFold(); });
    // Shell fold syncing for top panel and zen mode only; outline panel is its
    // own floating tool-panel (toggled via the same fold.store id).
    on('fold.changed', ({ id }) => {
      if (id !== 'shell.top' && id !== ZEN_FOLD_ID) return;
      syncShellFold();
    });
  }, { requires: ['render'] });
}
