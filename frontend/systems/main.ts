import type { Registry } from '../core';
import { Places } from '../types';

/** Zen = fold the whole app shell (hide top), leaving only the canvas —
 *  the same fold concept (Principle 18) applied to the app target: "less detail
 *  on everything". Toggle with `\` (it's the only exit once panels are hidden). */
const ZEN_FOLD_ID = 'shell.zen';

export function registerMain(system: Registry) {
  system('main', ({ on, emit, contexts, contribute, origin }) => {
    // Escape exits zen mode through the shared cancellation stack. `background:
    // false` keeps zen active on canvas clicks — it persists until an explicit
    // exit (`\` or Escape), so the faded panels don't pop back on a stray click.
    contexts.cancellation.register({
      origin,
      background: false,
      active: () => contexts.fold.folded(ZEN_FOLD_ID),
      cancel: () => contexts.fold.set(ZEN_FOLD_ID, true),
    });

    // `.shell` lives one level above the Top place. Walk up rather than reach
    // for a global selector so principle #5 (render-adjacent DOM access) holds.
    const shellEl = () => contexts.places.el(Places.Top)?.parentElement as HTMLElement | null;
    const syncShellFold = () => {
      const shell = shellEl();
      if (!shell) return;
      shell.dataset.zen = contexts.fold.folded(ZEN_FOLD_ID) ? 'true' : 'false';
    };
    contexts.commands.register([
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
    contribute({ surface: 'top', command: 'view.zen', kind: 'button', text: '☾', label: 'Toggle zen mode', order: 80 });
    on('app.start', () => { emit('render.shell'); syncShellFold(); });
    on('fold.changed', ({ id }) => { if (id === ZEN_FOLD_ID) syncShellFold(); });
  }, { requires: ['render'] });
}
