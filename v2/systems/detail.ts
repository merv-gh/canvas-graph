import { itemFoldId, type Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'detail.less': void;
    'detail.more': void;
  }
}

/** The polymorphic "less / more detail" verb, resolved against the current
 *  context (Principle 18): with a chosen set it folds / unfolds those items;
 *  with nothing chosen it zooms the canvas. One verb, target by "currentness" —
 *  the seed of the context command-algebra (additive for now: palette-reachable,
 *  existing zoom/collapse keys still work). */
export function registerDetail(system: Registry) {
  system('detail', ({ on, emit, contexts, selection, graphs }) => {
    contexts.commands.register([
      { id: 'detail.less', label: 'Less detail (fold / zoom out)', group: 'view', shortcut: '[', input: { on: 'keydown', key: '[', prevent: true } },
      { id: 'detail.more', label: 'More detail (unfold / zoom in)', group: 'view', shortcut: ']', input: { on: 'keydown', key: ']', prevent: true } },
    ]);
    const setFold = (open: boolean) =>
      selection.selectedAll().forEach(ref => contexts.fold.set(itemFoldId(ref, graphs.current.id), open));
    on('detail.less', () => selection.selectedAll().length ? setFold(false) : emit('view.zoom.out'));
    on('detail.more', () => selection.selectedAll().length ? setFold(true) : emit('view.zoom.in'));
  }, { requires: ['view.zoom'] });
}
