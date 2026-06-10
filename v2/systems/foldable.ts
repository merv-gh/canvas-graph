import type { Registry } from '../core';

/** Foldable: turns any element with `[data-fold-id]` into a fold toggle, and
 *  routes `fold.toggle` bus events through the shared `contexts.fold` store.
 *  Sections (outline collections), the whole left panel, and any future
 *  collapsible region plug into the same machinery — one click pattern, one
 *  persisted state map, one `.changed` fact event consumers listen to. */
export function registerFoldable(system: Registry) {
  system('foldable', ({ on, contexts }) => {
    contexts.commands.register([{
      id: 'fold.toggle',
      label: 'Toggle fold',
      group: 'ui',
      hidden: true,
      // `[data-fold-default-open]` lets a renderer declare its preferred initial
      // state (default true). The command reads it so the persisted store
      // matches user intent on first click of a never-toggled section.
      input: { on: 'click', selector: '[data-fold-id]', prevent: true, stop: true },
      payload: ({ target }) => {
        const el = (target as HTMLElement | null)?.closest('[data-fold-id]') as HTMLElement | null;
        return el ? { id: el.dataset.foldId ?? '' } : undefined;
      },
    }]);
    on('fold.toggle', ({ id }) => { if (id) contexts.fold.toggle(id); });
  }, { requires: ['input'] });
}
